import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ClickHouseClient } from "@clickhouse/client";
import { MULTI_LABEL_TLDS, parseAndSplitDomain } from "../../../lib/domain-splitter";

import type {
  BulkTransformRepository,
  ReadyTransformContextRecord,
} from "./types";

const ACTIVE_STATE_KEY = "hostname_serving";
const DEFAULT_FAILED_ROW_COUNT = 0;
const DEFAULT_LOOKUP_INSERT_BATCH_SIZE = 5_000;

const HOSTNAME_PATTERN =
  "^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$";
const IPV4_PATTERN =
  "^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$";

type ClickHouseClientLike = Pick<ClickHouseClient, "command" | "insert" | "query">;

type ClickHouseBulkTransformRepositoryOptions = {
  client: ClickHouseClientLike;
  schemaPath?: string;
  lookupInsertBatchSize?: number;
};

type ServingHostnameLookupRow = {
  hostname: string;
  snapshot_month: string;
};

type ApexLookupInsertRow = {
  domain: string;
  domain_normalized: string;
  domain_reversed: string;
  search_text: string;
};

type SubdomainLookupInsertRow = {
  subdomain: string;
  subdomain_normalized: string;
  parent_domain: string;
  parent_domain_normalized: string;
  hostname: string;
  hostname_normalized: string;
  hostname_reversed: string;
  search_text: string;
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

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
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

function reverseLookupValue(value: string) {
  return value.split("").reverse().join("");
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

export function buildLookupInsertBuffers(rows: ServingHostnameLookupRow[]) {
  const apexRows: ApexLookupInsertRow[] = [];
  const subdomainRows: SubdomainLookupInsertRow[] = [];
  const seenApexRows = new Set<string>();
  const seenSubdomainRows = new Set<string>();

  for (const row of rows) {
    const splitResult = parseAndSplitDomain(row.hostname);

    if (splitResult.type === "apex") {
      const dedupeKey = `${row.snapshot_month}\u0000${splitResult.domain}`;

      if (seenApexRows.has(dedupeKey)) {
        continue;
      }

      seenApexRows.add(dedupeKey);
      const normalized = normalizeLookupValue(splitResult.domain);

      apexRows.push({
        domain: splitResult.domain,
        domain_normalized: normalized,
        domain_reversed: reverseLookupValue(normalized),
        search_text: normalized,
      });
      continue;
    }

    const dedupeKey = `${row.snapshot_month}\u0000${splitResult.parent_domain}\u0000${splitResult.subdomain}`;

    if (seenSubdomainRows.has(dedupeKey)) {
      continue;
    }

    seenSubdomainRows.add(dedupeKey);
    const hostname = `${splitResult.subdomain}.${splitResult.parent_domain}`;

    const hostnameNormalized = normalizeLookupValue(hostname);

    subdomainRows.push({
      subdomain: splitResult.subdomain,
      subdomain_normalized: normalizeLookupValue(splitResult.subdomain),
      parent_domain: splitResult.parent_domain,
      parent_domain_normalized: normalizeLookupValue(splitResult.parent_domain),
      hostname,
      hostname_normalized: hostnameNormalized,
      hostname_reversed: reverseLookupValue(hostnameNormalized),
      search_text: hostnameNormalized,
    });
  }

  return {
    apexRows,
    subdomainRows,
  };
}

export function deriveDomainParts(hostname: string) {
  const splitResult = parseAndSplitDomain(hostname);
  const apexDomain =
    splitResult.type === "apex" ? splitResult.domain : splitResult.parent_domain;
  const labels = apexDomain.split(".");
  const firstLabel =
    splitResult.type === "subdomain" ? splitResult.subdomain.split(".")[0] ?? "" : labels[0] ?? "";
  const twoLabelTld = labels.slice(-2).join(".");

  if (labels.length >= 3 && (MULTI_LABEL_TLDS as readonly string[]).includes(twoLabelTld)) {
    return {
      apexDomain,
      tld: twoLabelTld,
      firstLabel,
    };
  }

  return {
    apexDomain,
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

function buildSplitLookupTableStatements() {
  return [
    `
      CREATE TABLE IF NOT EXISTS tech_stack_bulk.bulk_apex_domain_lookup
      (
        domain String,
        domain_normalized String,
        domain_reversed String,
        search_text String,
        is_functional UInt8 DEFAULT 1,
        updated_at DateTime DEFAULT now(),
        INDEX idx_apex_search_text search_text TYPE ngrambf_v1(3, 256, 2, 0) GRANULARITY 1
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY domain_normalized
    `,
    `
      CREATE TABLE IF NOT EXISTS tech_stack_bulk.bulk_subdomain_lookup_v2
      (
        subdomain String,
        subdomain_normalized String,
        parent_domain String,
        parent_domain_normalized String,
        hostname String,
        hostname_normalized String,
        hostname_reversed String,
        search_text String,
        is_functional UInt8 DEFAULT 1,
        updated_at DateTime DEFAULT now(),
        INDEX idx_subdomain_search_text search_text TYPE ngrambf_v1(3, 256, 2, 0) GRANULARITY 1
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (parent_domain_normalized, hostname_normalized)
    `,
  ];
}

export class ClickHouseBulkTransformRepository implements BulkTransformRepository {
  private readonly client: ClickHouseClientLike;
  private readonly schemaPath: string;
  private readonly lookupInsertBatchSize: number;
  private schemaRegistered = false;
  private splitLookupTablesEnsured = false;

  constructor(options: ClickHouseBulkTransformRepositoryOptions) {
    this.client = options.client;
    this.schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
    this.lookupInsertBatchSize =
      options.lookupInsertBatchSize ?? DEFAULT_LOOKUP_INSERT_BATCH_SIZE;
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

    await this.ensureSplitLookupTables();
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
    const servingHostnameRows = await readRows<Record<string, unknown>>(
      this.client,
      `
        SELECT
          hostname,
          snapshot_month
        FROM bulk_hostname_serving
        WHERE load_version = {load_version: String}
      `,
      {
        load_version: params.loadVersion,
      },
    );
    const { apexRows, subdomainRows } = buildLookupInsertBuffers(
      servingHostnameRows.map((row) => ({
        hostname: String(row.hostname),
        snapshot_month: String(row.snapshot_month),
      })),
    );
    await this.ensureSplitLookupTables();
    await this.insertApexLookupRows(apexRows);
    await this.insertSubdomainLookupRows(subdomainRows);

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

  private async insertApexLookupRows(rows: ApexLookupInsertRow[]) {
    for (const batch of chunkRows(rows, this.lookupInsertBatchSize)) {
      await this.client.insert({
        table: "tech_stack_bulk.bulk_apex_domain_lookup",
        values: batch.map((row) => ({
          domain: row.domain,
          domain_normalized: row.domain_normalized,
          domain_reversed: row.domain_reversed,
          search_text: row.search_text,
        })),
        format: "JSONEachRow",
      });
    }
  }

  private async insertSubdomainLookupRows(
    rows: SubdomainLookupInsertRow[],
  ) {
    for (const batch of chunkRows(rows, this.lookupInsertBatchSize)) {
      await this.client.insert({
        table: "tech_stack_bulk.bulk_subdomain_lookup_v2",
        values: batch.map((row) => ({
          subdomain: row.subdomain,
          subdomain_normalized: row.subdomain_normalized,
          parent_domain: row.parent_domain,
          parent_domain_normalized: row.parent_domain_normalized,
          hostname: row.hostname,
          hostname_normalized: row.hostname_normalized,
          hostname_reversed: row.hostname_reversed,
          search_text: row.search_text,
        })),
        format: "JSONEachRow",
      });
    }
  }

  private async ensureSplitLookupTables() {
    if (this.splitLookupTablesEnsured) {
      return;
    }

    for (const statement of buildSplitLookupTableStatements()) {
      await this.client.command({
        query: statement,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      });
    }

    this.splitLookupTablesEnsured = true;
  }
}
