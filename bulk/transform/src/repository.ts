import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ClickHouseClient } from "@clickhouse/client";

import type {
  BulkTransformRepository,
  ReadyTransformContextRecord,
} from "./types";

const ACTIVE_STATE_KEY = "hostname_serving";
const DEFAULT_FAILED_ROW_COUNT = 0;

const MULTI_LABEL_TLDS = [
  "ac.uk",
  "co.in",
  "co.jp",
  "co.uk",
  "com.au",
  "com.br",
  "com.mx",
  "gov.uk",
  "net.au",
  "org.au",
  "org.uk",
] as const;

const HOSTNAME_PATTERN =
  "^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$";
const IPV4_PATTERN =
  "^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$";

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

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildHostnameNormalizationExpression(rawExpression: string) {
  return `CASE
      WHEN NULLIF(trim(BOTH ' ' FROM ${rawExpression}), '') IS NULL THEN NULL
      ELSE lowerUTF8(replaceRegexpAll(trim(BOTH ' ' FROM ${rawExpression}), ${sqlString("\\.+$")}, ''))
    END`;
}

function buildHostnameValidityExpression(hostnameExpression: string) {
  return `${hostnameExpression} IS NOT NULL
      AND position(${hostnameExpression}, '.') > 0
      AND match(${hostnameExpression}, ${sqlString(HOSTNAME_PATTERN)})`;
}

function buildIpNormalizationExpression(rawExpression: string) {
  return `NULLIF(trim(BOTH ' ' FROM ${rawExpression}), '')`;
}

function buildIpValidityExpression(ipExpression: string) {
  const normalizedIpv6Expression = `lowerUTF8(${ipExpression})`;
  const ipv6SegmentsExpression = `splitByChar(':', ${normalizedIpv6Expression})`;
  const nonEmptyIpv6SegmentsExpression = `arrayFilter(segment -> length(segment) > 0, ${ipv6SegmentsExpression})`;

  return `${ipExpression} IS NOT NULL
      AND (
        match(${ipExpression}, ${sqlString(IPV4_PATTERN)})
        OR (
          position(${ipExpression}, ':') > 0
          AND match(${normalizedIpv6Expression}, ${sqlString("^[0-9a-f:]+$")})
          AND NOT match(${normalizedIpv6Expression}, ${sqlString("^:+$")})
          AND NOT match(${normalizedIpv6Expression}, ${sqlString(":::")})
          AND NOT match(${normalizedIpv6Expression}, ${sqlString("::.*::")})
          AND length(${nonEmptyIpv6SegmentsExpression}) > 0
          AND length(${nonEmptyIpv6SegmentsExpression}) <= 8
          AND length(arrayFilter(segment -> length(segment) > 4, ${nonEmptyIpv6SegmentsExpression})) = 0
          AND length(arrayFilter(segment -> NOT match(segment, ${sqlString("^[0-9a-f]{1,4}$")}), ${nonEmptyIpv6SegmentsExpression})) = 0
          AND (
            (
              position(${normalizedIpv6Expression}, '::') > 0
              AND length(${nonEmptyIpv6SegmentsExpression}) < 8
            )
            OR (
              position(${normalizedIpv6Expression}, '::') = 0
              AND length(${ipv6SegmentsExpression}) = 8
            )
          )
        )
      )`;
}

function buildOptionalHostnameNormalizationExpression(rawExpression: string) {
  const normalizedExpression = buildHostnameNormalizationExpression(rawExpression);
  const validExpression = buildHostnameValidityExpression(normalizedExpression);

  return `CASE
      WHEN ${validExpression} THEN ${normalizedExpression}
      ELSE NULL
    END`;
}

function buildTldExpression(hostnameExpression: string) {
  const multiLabelCases = MULTI_LABEL_TLDS.map(
    (tld) =>
      `WHEN ${hostnameExpression} LIKE ${sqlString(`%.${tld}`)} THEN ${sqlString(tld)}`,
  ).join("\n          ");

  return `CASE
          ${multiLabelCases}
          ELSE extract(${hostnameExpression}, ${sqlString("\\.([^.]+)$")})
        END`;
}

function buildApexDomainExpression(hostnameExpression: string) {
  const multiLabelCases = MULTI_LABEL_TLDS.map((tld) => {
    const escapedTld = escapeRegex(tld);

    return `WHEN ${hostnameExpression} LIKE ${sqlString(`%.${tld}`)} THEN extract(${hostnameExpression}, ${sqlString(`([^.]+\\.${escapedTld})$`)})`;
  }).join("\n          ");

  return `CASE
          ${multiLabelCases}
          ELSE extract(${hostnameExpression}, ${sqlString("([^.]+\\.[^.]+)$")})
        END`;
}

function buildFirstLabelExpression(hostnameExpression: string) {
  return `arrayElement(splitByChar('.', ${hostnameExpression}), 1)`;
}

export function deriveDomainParts(hostname: string) {
  const labels = hostname.split(".");
  const firstLabel = labels[0] ?? "";
  const twoLabelTld = labels.slice(-2).join(".");

  if (labels.length >= 3 && MULTI_LABEL_TLDS.includes(twoLabelTld)) {
    return {
      apexDomain: labels.slice(-3).join("."),
      tld: twoLabelTld,
      firstLabel,
    };
  }

  return {
    apexDomain: labels.slice(-2).join("."),
    tld: labels.at(-1) ?? "",
    firstLabel,
  };
}

function buildTransformInsertQuery() {
  const normalizedHostnameExpression = buildHostnameNormalizationExpression("raw_hostname");
  const normalizedIpExpression = buildIpNormalizationExpression("raw_ip_address");
  const normalizedCnameExpression = buildOptionalHostnameNormalizationExpression(
    "raw_cname_target",
  );
  const normalizedProviderExpression = `NULLIF(trim(BOTH ' ' FROM raw_provider_hint), '')`;
  const hostnameValidExpression = buildHostnameValidityExpression("hostname");
  const ipValidExpression = buildIpValidityExpression("ip_address");
  const apexDomainExpression = buildApexDomainExpression("hostname");
  const tldExpression = buildTldExpression("hostname");
  const firstLabelExpression = buildFirstLabelExpression("hostname");

  return `
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
    WITH prepared_rows AS (
      SELECT
        snapshot_month,
        ${normalizedHostnameExpression} AS hostname,
        ${normalizedIpExpression} AS ip_address,
        ${normalizedCnameExpression} AS cname_target,
        ${normalizedProviderExpression} AS provider_hint
      FROM bulk_hostname_raw
      WHERE import_version = {import_version: String}
        AND snapshot_month = {snapshot_month: String}
    ),
    classified_rows AS (
      SELECT
        snapshot_month,
        ip_address,
        hostname,
        ${apexDomainExpression} AS apex_domain,
        ${tldExpression} AS tld,
        ${firstLabelExpression} AS first_label,
        cname_target,
        provider_hint,
        CASE
          WHEN hostname IS NULL THEN 'hostname_missing'
          WHEN NOT (${hostnameValidExpression}) THEN 'hostname_invalid'
          WHEN ip_address IS NULL THEN 'ip_address_missing'
          WHEN NOT (${ipValidExpression}) THEN 'ip_address_invalid'
          ELSE NULL
        END AS rejection_reason
      FROM prepared_rows
    )
    SELECT
      {load_version: String} AS load_version,
      snapshot_month,
      ip_address,
      hostname,
      apex_domain,
      tld,
      first_label,
      cname_target,
      provider_hint
    FROM classified_rows
    WHERE rejection_reason IS NULL
  `;
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

  async findReadyTransformBySourceKey(
    sourceKey: string,
  ): Promise<ReadyTransformContextRecord | null> {
    const rows = await readRows<Record<string, unknown>>(
      this.client,
      `
        SELECT
          load_version,
          import_version,
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
      importVersion: String(row.import_version),
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
      query: buildTransformInsertQuery(),
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

  async markTransformReady(params: ReadyTransformContextRecord) {
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
