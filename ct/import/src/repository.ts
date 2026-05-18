import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import path from "node:path";

import type { ClickHouseClient } from "@clickhouse/client";

type ClickHouseClientLike = Pick<ClickHouseClient, "command" | "query" | "insert">;

const DEFAULT_SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../schema/clickhouse-ct.sql",
);

type CtRawImportRow = {
  import_version: string;
  dump_date: string;
  source_line_number: number;
  raw_line: string;
  raw_line_sha256: string;
  source_url: string;
  source_sha256: string;
};

function splitSqlStatements(sqlText: string) {
  return sqlText
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
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

function parseRequiredNumber(value: unknown, fieldName: string) {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (Number.isNaN(numericValue)) {
    throw new Error(`ClickHouse returned a non-numeric ${fieldName}.`);
  }

  return numericValue;
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

export class ClickHouseCtImportRepository {
  private readonly client: ClickHouseClientLike;
  private readonly schemaPath: string;
  private readonly batchSize: number;
  private schemaRegistered = false;

  constructor(options: { client: ClickHouseClientLike; schemaPath?: string; batchSize?: number }) {
    this.client = options.client;
    this.schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
    this.batchSize = Math.max(1, options.batchSize ?? 10_000);
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
    dumpDate: string;
    sourceUrl: string;
    sourceGzipPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    recordedAt: string;
  }) {
    await this.writeImportAttempt({
      ...params,
      status: "importing",
      rowCount: 0,
      errorMessage: null,
    });
  }

  async importRawCtLines(params: {
    importVersion: string;
    dumpDate: string;
    sourceUrl: string;
    sourceSha256: string;
    gzipPath: string;
  }) {
    const batch: CtRawImportRow[] = [];
    const lineReader = createInterface({
      input: createReadStream(params.gzipPath).pipe(createGunzip()),
      crlfDelay: Infinity,
    });

    let lineNumber = 0;

    const flushBatch = async () => {
      if (batch.length === 0) {
        return;
      }

      await this.client.insert({
        table: "ct_log_line_raw",
        values: batch.splice(0, batch.length),
        format: "JSONEachRow",
      });
    };

    for await (const rawLine of lineReader) {
      lineNumber += 1;
      batch.push({
        import_version: params.importVersion,
        dump_date: params.dumpDate,
        source_line_number: lineNumber,
        raw_line: rawLine,
        raw_line_sha256: createHash("sha256").update(rawLine).digest("hex"),
        source_url: params.sourceUrl,
        source_sha256: params.sourceSha256,
      });

      if (batch.length >= this.batchSize) {
        await flushBatch();
      }
    }

    await flushBatch();

    const rowCountRows = await readRows<Record<string, unknown>>(
      this.client,
      `
        SELECT count() AS row_count
        FROM ct_log_line_raw
        WHERE import_version = {import_version: String}
      `,
      {
        import_version: params.importVersion,
      },
    );

    return {
      rowCount: parseRequiredNumber(rowCountRows[0]?.row_count ?? lineNumber, "row_count"),
    };
  }

  async markImportReady(params: {
    importVersion: string;
    dumpDate: string;
    sourceUrl: string;
    sourceGzipPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    rowCount: number;
    recordedAt: string;
  }) {
    await this.writeImportAttempt({
      ...params,
      status: "ready",
      errorMessage: null,
    });
  }

  async markImportFailed(params: {
    importVersion: string;
    dumpDate: string;
    sourceUrl: string;
    sourceGzipPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    errorMessage: string;
    recordedAt: string;
  }) {
    await this.writeImportAttempt({
      ...params,
      status: "failed",
      rowCount: 0,
    });
  }

  private async writeImportAttempt(params: {
    importVersion: string;
    dumpDate: string;
    sourceUrl: string;
    sourceGzipPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    status: "importing" | "ready" | "failed";
    rowCount: number;
    errorMessage: string | null;
    recordedAt: string;
  }) {
    await this.client.command({
      query: `
        INSERT INTO ct_import_attempt_events
        (
          import_version,
          dump_date,
          source_url,
          source_gzip_path,
          source_file_bytes,
          source_file_sha256,
          status,
          row_count,
          error_message,
          recorded_at
        )
        VALUES
        (
          {import_version: String},
          {dump_date: Date},
          {source_url: String},
          {source_gzip_path: String},
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
        dump_date: params.dumpDate,
        source_url: params.sourceUrl,
        source_gzip_path: params.sourceGzipPath,
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
