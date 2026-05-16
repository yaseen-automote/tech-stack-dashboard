import type { ClickHouseClient } from "@clickhouse/client";

type ClickHouseClientLike = Pick<ClickHouseClient, "query">;

type LookupRowsOptions = {
  query: string;
  queryParams?: Record<string, unknown>;
};

type BulkLookupOptions = {
  limit: number;
};

export type BulkHostnameRow = {
  hostname: string;
  snapshotMonth?: string;
};

export type BulkInfrastructureSummary = {
  snapshotMonth?: string;
  totals: {
    hostnames: number;
    ipAddresses: number;
    cnames: number;
    providers: number;
  };
  providers: Array<{
    provider: string;
    count: number;
  }>;
  cnameTargets: Array<{
    target: string;
    count: number;
  }>;
};

export interface BulkApiRepository {
  lookupReverseIp(params: { ip: string } & BulkLookupOptions): Promise<BulkHostnameRow[]>;
  lookupSubdomains(params: { domain: string } & BulkLookupOptions): Promise<BulkHostnameRow[]>;
  lookupCnameSources(params: { domain: string } & BulkLookupOptions): Promise<BulkHostnameRow[]>;
  hasBulkCnameSupport(): Promise<boolean>;
  lookupInfrastructureSummary(params: { domain: string }): Promise<BulkInfrastructureSummary>;
}

type ClickHouseBulkApiRepositoryOptions = {
  client: ClickHouseClientLike;
};

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
  options: LookupRowsOptions,
): Promise<T[]> {
  const resultSet = await client.query({
    query: options.query,
    query_params: options.queryParams,
    format: "JSONEachRow",
  });

  return (await resultSet.json()) as T[];
}

function normalizeSnapshotMonth(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export class ClickHouseBulkApiRepository implements BulkApiRepository {
  private readonly client: ClickHouseClientLike;

  constructor(options: ClickHouseBulkApiRepositoryOptions) {
    this.client = options.client;
  }

  async lookupReverseIp(params: { ip: string } & BulkLookupOptions): Promise<BulkHostnameRow[]> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT DISTINCT
          hostname,
          snapshot_month
        FROM bulk_active_hostname_serving
        WHERE ip_address = {ip_address: String}
        ORDER BY hostname ASC
        LIMIT {limit: UInt64}
      `,
      queryParams: {
        ip_address: params.ip,
        limit: params.limit,
      },
    });

    return rows.map((row) => ({
      hostname: String(row.hostname),
      snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
    }));
  }

  async lookupSubdomains(
    params: { domain: string } & BulkLookupOptions,
  ): Promise<BulkHostnameRow[]> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT DISTINCT
          hostname,
          snapshot_month
        FROM bulk_active_hostname_serving
        WHERE apex_domain = {apex_domain: String}
        ORDER BY hostname ASC
        LIMIT {limit: UInt64}
      `,
      queryParams: {
        apex_domain: params.domain,
        limit: params.limit,
      },
    });

    return rows.map((row) => ({
      hostname: String(row.hostname),
      snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
    }));
  }

  async lookupCnameSources(
    params: { domain: string } & BulkLookupOptions,
  ): Promise<BulkHostnameRow[]> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT DISTINCT
          hostname,
          snapshot_month
        FROM bulk_active_hostname_serving
        WHERE apex_domain = {apex_domain: String}
          AND isNotNull(cname_target)
          AND cname_target != ''
        ORDER BY hostname ASC
        LIMIT {limit: UInt64}
      `,
      queryParams: {
        apex_domain: params.domain,
        limit: params.limit,
      },
    });

    return rows.map((row) => ({
      hostname: String(row.hostname),
      snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
    }));
  }

  async hasBulkCnameSupport() {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT
          count() > 0 AS has_cname_data
        FROM bulk_active_hostname_serving
        WHERE isNotNull(cname_target)
          AND cname_target != ''
      `,
    });

    const rawValue = rows[0]?.has_cname_data;

    if (typeof rawValue === "boolean") {
      return rawValue;
    }

    return rawValue === 1 || rawValue === "1";
  }

  async lookupInfrastructureSummary(params: { domain: string }): Promise<BulkInfrastructureSummary> {
    const [summaryRows, providerRows, cnameRows] = await Promise.all([
      readRows<Record<string, unknown>>(this.client, {
        query: `
          SELECT
            any(snapshot_month) AS snapshot_month,
            uniqExact(hostname) AS hostname_count,
            uniqExact(ip_address) AS ip_address_count,
            uniqExactIf(cname_target, isNotNull(cname_target) AND cname_target != '') AS cname_count,
            uniqExactIf(provider_hint, isNotNull(provider_hint) AND provider_hint != '') AS provider_count
          FROM bulk_active_hostname_serving
          WHERE apex_domain = {apex_domain: String}
        `,
        queryParams: {
          apex_domain: params.domain,
        },
      }),
      readRows<Record<string, unknown>>(this.client, {
        query: `
          SELECT
            provider_hint,
            count() AS provider_count
          FROM bulk_active_hostname_serving
          WHERE apex_domain = {apex_domain: String}
            AND isNotNull(provider_hint)
            AND provider_hint != ''
          GROUP BY provider_hint
          ORDER BY provider_count DESC, provider_hint ASC
          LIMIT 10
        `,
        queryParams: {
          apex_domain: params.domain,
        },
      }),
      readRows<Record<string, unknown>>(this.client, {
        query: `
          SELECT
            cname_target,
            count() AS cname_count
          FROM bulk_active_hostname_serving
          WHERE apex_domain = {apex_domain: String}
            AND isNotNull(cname_target)
            AND cname_target != ''
          GROUP BY cname_target
          ORDER BY cname_count DESC, cname_target ASC
          LIMIT 10
        `,
        queryParams: {
          apex_domain: params.domain,
        },
      }),
    ]);

    const summaryRow = summaryRows[0];

    return {
      snapshotMonth: normalizeSnapshotMonth(summaryRow?.snapshot_month),
      totals: {
        hostnames: parseRequiredNumber(summaryRow?.hostname_count ?? 0, "hostname_count"),
        ipAddresses: parseRequiredNumber(summaryRow?.ip_address_count ?? 0, "ip_address_count"),
        cnames: parseRequiredNumber(summaryRow?.cname_count ?? 0, "cname_count"),
        providers: parseRequiredNumber(summaryRow?.provider_count ?? 0, "provider_count"),
      },
      providers: providerRows.map((row) => ({
        provider: String(row.provider_hint),
        count: parseRequiredNumber(row.provider_count, "provider_count"),
      })),
      cnameTargets: cnameRows.map((row) => ({
        target: String(row.cname_target),
        count: parseRequiredNumber(row.cname_count, "cname_count"),
      })),
    };
  }
}
