import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import type { ClickHouseClient } from "@clickhouse/client";

import type { BulkImportRepository } from "./types";

type ClickHouseClientLike = Pick<ClickHouseClient, "command" | "exec" | "query">;

type ClickHouseBulkImportRepositoryOptions = {
  client: ClickHouseClientLike;
  schemaPath?: string;
};

const DEFAULT_SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../schema/clickhouse-raw.sql",
);

const DEFAULT_FAILED_ROW_COUNT = 0;

function normalizePathForClickHouse(filePath: string) {
  return path.resolve(filePath).replaceAll("\\", "/");
}

function splitSqlStatements(sqlText: string) {
  return sqlText
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function parseRequiredNumber(value: unknown, fieldName: string) {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (Number.isNaN(numericValue)) {
    throw new Error(`ClickHouse returned a non-numeric ${fieldName}.`);
  }

  return numericValue;
}

async function readRows<T extends Record<string, unknown>>(
  client: ClickHouseClientLike,
  query: string,
  queryParams?: Record<string, unknown>,
): Promise<T[]> {
  const resultSet = await client.query({
    query,
    query_params: queryParams,
    format: "JSONEachRow",
  });

  return (await resultSet.json()) as T[];
}

function formatClickHouseDateTime64(date: Date) {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");

  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`,
  ].join(" ");
}

const CLICKHOUSE_DATETIME64_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

function normalizeRecordedAtForClickHouse(recordedAt: string) {
  if (CLICKHOUSE_DATETIME64_PATTERN.test(recordedAt)) {
    return recordedAt;
  }

  const parsedDate = new Date(recordedAt);

  if (Number.isNaN(parsedDate.getTime())) {
    return recordedAt;
  }

  return formatClickHouseDateTime64(parsedDate);
}

export class ClickHouseBulkImportRepository implements BulkImportRepository {
  private readonly client: ClickHouseClientLike;
  private readonly schemaPath: string;
  private schemaRegistered = false;

  constructor(options: ClickHouseBulkImportRepositoryOptions) {
    this.client = options.client;
    this.schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
  }

  async ensureSchema() {
    if (this.schemaRegistered) {
      return;
    }

    const schemaSql = await readFile(this.schemaPath, "utf8");

    for (const statement of splitSqlStatements(schemaSql)) {
      await this.client.command({
        query: statement,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      });
    }

    this.schemaRegistered = true;
  }

  async registerImportStart(params: {
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    sourceParquetPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    recordedAt: string;
  }) {
    await this.writeImportAttemptEvent({
      ...params,
      status: "importing",
      rowCount: 0,
      errorMessage: null,
    });
  }

  async importRawRowsFromParquet(params: {
    importVersion: string;
    snapshotMonth: string;
    parquetPath: string;
  }) {
    const execResult = await this.client.exec({
      query: `
        INSERT INTO bulk_hostname_raw
        (
          import_version,
          snapshot_month,
          source_row_number,
          raw_hostname,
          raw_ip_address,
          raw_cname_target,
          raw_provider_hint
        )
        SELECT
          {import_version: String},
          {snapshot_month: String},
          rowNumberInAllBlocks() AS source_row_number,
          hostname,
          ip_address,
          cname_target,
          provider_hint
        FROM input(
          'hostname Nullable(String),
           ip_address Nullable(String),
           cname_target Nullable(String),
           provider_hint Nullable(String)'
        )
        FORMAT Parquet
      `,
      query_params: {
        import_version: params.importVersion,
        snapshot_month: params.snapshotMonth,
      },
      values: createReadStream(normalizePathForClickHouse(params.parquetPath)),
    });

    await finished(execResult.stream);

    const rowCountRows = await readRows<Record<string, unknown>>(
      this.client,
      `
        SELECT count() AS row_count
        FROM bulk_hostname_raw
        WHERE import_version = {import_version: String}
      `,
      {
        import_version: params.importVersion,
      },
    );

    return {
      rowCount: parseRequiredNumber(rowCountRows[0]?.row_count, "row_count"),
    };
  }

  async markImportReady(params: {
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    sourceParquetPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    rowCount: number;
    recordedAt: string;
  }) {
    await this.writeImportAttemptEvent({
      ...params,
      status: "ready",
      errorMessage: null,
    });
  }

  async markImportFailed(params: {
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    sourceParquetPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    errorMessage: string;
    recordedAt: string;
  }) {
    await this.writeImportAttemptEvent({
      ...params,
      status: "failed",
      rowCount: DEFAULT_FAILED_ROW_COUNT,
    });
  }

  private async writeImportAttemptEvent(params: {
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    sourceParquetPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    status: "importing" | "ready" | "failed";
    rowCount: number;
    errorMessage: string | null;
    recordedAt: string;
  }) {
    await this.client.command({
      query: `
        INSERT INTO bulk_import_attempt_events
        (
          import_version,
          source_key,
          snapshot_month,
          source_parquet_path,
          source_file_bytes,
          source_file_sha256,
          status,
          row_count,
          error_message,
          recorded_at
        )
        VALUES (
          {import_version: String},
          {source_key: String},
          {snapshot_month: String},
          {source_parquet_path: String},
          {source_file_bytes: UInt64},
          {source_file_sha256: FixedString(64)},
          {status: String},
          {row_count: UInt64},
          {error_message: Nullable(String)},
          {recorded_at: DateTime64(3)}
        )
      `,
      query_params: {
        import_version: params.importVersion,
        source_key: params.sourceKey,
        snapshot_month: params.snapshotMonth,
        source_parquet_path: params.sourceParquetPath,
        source_file_bytes: params.sourceFileBytes,
        source_file_sha256: params.sourceFileSha256,
        status: params.status,
        row_count: params.rowCount,
        error_message: params.errorMessage,
        recorded_at: normalizeRecordedAtForClickHouse(params.recordedAt),
      },
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
  }
}
