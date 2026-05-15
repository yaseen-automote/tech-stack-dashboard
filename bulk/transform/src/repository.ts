import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ClickHouseClient } from "@clickhouse/client";

import type { BulkTransformRepository, ReadyTransformRecord } from "./types";

const ACTIVE_STATE_KEY = "hostname_serving";
const DEFAULT_FAILED_ROW_COUNT = 0;

type ClickHouseClientLike = Pick<ClickHouseClient, "command" | "query">;

type ClickHouseBulkTransformRepositoryOptions = {
  client: ClickHouseClientLike;
  schemaPath?: string;
};

const DEFAULT_SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../schema/clickhouse-serving.sql",
);

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

export class ClickHouseBulkTransformRepository implements BulkTransformRepository {
  private readonly client: ClickHouseClientLike;
  private readonly schemaPath: string;
  private schemaRegistered = false;

  constructor(options: ClickHouseBulkTransformRepositoryOptions) {
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

  async findReadyTransformBySourceKey(sourceKey: string): Promise<ReadyTransformRecord | null> {
    const rows = await readRows<Record<string, unknown>>(
      this.client,
      `
        SELECT
          load_version,
          source_key,
          snapshot_month,
          row_count
        FROM bulk_transform_attempts_latest
        WHERE source_key = {source_key: String}
          AND status = 'ready'
        ORDER BY latest_recorded_at DESC
        LIMIT 1
      `,
      {
        source_key: sourceKey,
      },
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      loadVersion: String(row.load_version),
      sourceKey: String(row.source_key),
      snapshotMonth: String(row.snapshot_month),
      rowCount: parseRequiredNumber(row.row_count, "row_count"),
    };
  }

  async registerTransformStart(params: {
    loadVersion: string;
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
  }) {
    await this.writeTransformAttemptEvent({
      ...params,
      status: "transforming",
      rowCount: 0,
      errorMessage: null,
    });
  }

  async transformImportIntoServing(params: {
    loadVersion: string;
    importVersion: string;
    snapshotMonth: string;
  }) {
    await this.client.command({
      query: `
        INSERT INTO bulk_hostname_serving
        (
          load_version,
          snapshot_month,
          ip_address,
          hostname,
          apex_domain,
          tld,
          first_label,
          cname_target,
          provider_hint
        )
        SELECT
          {load_version: String},
          snapshot_month,
          lowerUTF8(trim(BOTH ' ' FROM raw_ip_address)) AS ip_address,
          lowerUTF8(trim(BOTH ' ' FROM raw_hostname)) AS hostname,
          arrayStringConcat(arraySlice(splitByChar('.', lowerUTF8(trim(BOTH ' ' FROM raw_hostname))), -2), '.') AS apex_domain,
          arrayElement(splitByChar('.', lowerUTF8(trim(BOTH ' ' FROM raw_hostname))), -1) AS tld,
          arrayElement(splitByChar('.', lowerUTF8(trim(BOTH ' ' FROM raw_hostname))), 1) AS first_label,
          nullIf(lowerUTF8(trim(BOTH ' ' FROM raw_cname_target)), '') AS cname_target,
          nullIf(lowerUTF8(trim(BOTH ' ' FROM raw_provider_hint)), '') AS provider_hint
        FROM bulk_hostname_raw
        WHERE import_version = {import_version: String}
          AND snapshot_month = {snapshot_month: String}
          AND raw_hostname IS NOT NULL
          AND raw_hostname != ''
          AND raw_ip_address IS NOT NULL
          AND raw_ip_address != ''
      `,
      query_params: {
        load_version: params.loadVersion,
        import_version: params.importVersion,
        snapshot_month: params.snapshotMonth,
      },
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });

    const rowCountRows = await readRows<Record<string, unknown>>(
      this.client,
      `
        SELECT count() AS row_count
        FROM bulk_hostname_serving
        WHERE load_version = {load_version: String}
      `,
      {
        load_version: params.loadVersion,
      },
    );

    return parseRequiredNumber(rowCountRows[0]?.row_count, "row_count");
  }

  async markTransformReady(
    params: ReadyTransformRecord & {
      importVersion: string;
    },
  ) {
    await this.writeTransformAttemptEvent({
      loadVersion: params.loadVersion,
      importVersion: params.importVersion,
      sourceKey: params.sourceKey,
      snapshotMonth: params.snapshotMonth,
      status: "ready",
      rowCount: params.rowCount,
      errorMessage: null,
    });
  }

  async markTransformFailed(params: {
    loadVersion: string;
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    errorMessage: string;
  }) {
    await this.writeTransformAttemptEvent({
      loadVersion: params.loadVersion,
      importVersion: params.importVersion,
      sourceKey: params.sourceKey,
      snapshotMonth: params.snapshotMonth,
      status: "failed",
      rowCount: DEFAULT_FAILED_ROW_COUNT,
      errorMessage: params.errorMessage,
    });
  }

  async activateLoad(params: {
    loadVersion: string;
    snapshotMonth: string;
  }) {
    await this.client.command({
      query: `
        INSERT INTO bulk_runtime_state_events
        (
          state_key,
          load_version,
          snapshot_month,
          recorded_at
        )
        VALUES (
          {state_key: String},
          {load_version: String},
          {snapshot_month: String},
          now64(3)
        )
      `,
      query_params: {
        state_key: ACTIVE_STATE_KEY,
        load_version: params.loadVersion,
        snapshot_month: params.snapshotMonth,
      },
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
  }

  private async writeTransformAttemptEvent(params: {
    loadVersion: string;
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    status: "transforming" | "ready" | "failed";
    rowCount: number;
    errorMessage: string | null;
  }) {
    await this.client.command({
      query: `
        INSERT INTO bulk_transform_attempt_events
        (
          load_version,
          import_version,
          source_key,
          snapshot_month,
          status,
          row_count,
          error_message,
          recorded_at
        )
        VALUES (
          {load_version: String},
          {import_version: String},
          {source_key: String},
          {snapshot_month: String},
          {status: String},
          {row_count: UInt64},
          {error_message: Nullable(String)},
          now64(3)
        )
      `,
      query_params: {
        load_version: params.loadVersion,
        import_version: params.importVersion,
        source_key: params.sourceKey,
        snapshot_month: params.snapshotMonth,
        status: params.status,
        row_count: params.rowCount,
        error_message: params.errorMessage,
      },
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
  }
}
