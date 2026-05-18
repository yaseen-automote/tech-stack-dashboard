import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";

import type {
  CtAlertCategory,
  CtAlertSeverity,
  CtAlertSummary,
  CtWatchType,
  CtWatchlistEntry,
} from "@/ct/types";

type ClickHouseClientLike = Pick<ClickHouseClient, "command" | "insert" | "query">;

type LookupRowsOptions = {
  query: string;
  queryParams?: Record<string, unknown>;
};

type BulkLookupOptions = {
  limit?: number;
};

type SubdomainSearchScope = "domains" | "subdomains" | "both";
type SubdomainSearchModifier = "starts_with" | "ends_with" | "contains";
const DEFAULT_SUBDOMAIN_LIMIT = 100;
const INVALID_SUBDOMAIN_WILDCARD_ERROR =
  "Use * as the only wildcard in domain and subdomain search terms.";

export type BulkHostnameRow = {
  hostname: string;
  apexDomain?: string;
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

export type BulkCtAlertFeedRow = {
  id: string;
  observedAt: string;
  domain: string;
  category: CtAlertCategory;
  severity: CtAlertSeverity;
  watchType: CtWatchType;
  matchedTerm: string;
  reasons: string[];
  issuerName?: string | null;
};

export type BulkCtAlertFeed = {
  results: BulkCtAlertFeedRow[];
  total: number;
};

type CtAlertLookupOptions = {
  limit: number;
  offset: number;
  category?: CtAlertCategory;
  severity?: CtAlertSeverity;
  watchType?: CtWatchType;
  dumpDate?: string;
};

type CtWatchlistCreateInput = {
  watchType: CtWatchType;
  term: string;
  enabled: boolean;
};

type CtWatchlistUpdateInput = {
  entryId: string;
  watchType?: CtWatchType;
  term?: string;
  enabled?: boolean;
};

export interface BulkApiRepository {
  lookupReverseIp(params: { ip: string } & BulkLookupOptions): Promise<BulkHostnameRow[]>;
  lookupSubdomains(
    params: {
      scope: SubdomainSearchScope;
      domainTerm?: string;
      domainModifier?: SubdomainSearchModifier;
      subdomainTerm?: string;
      subdomainModifier?: SubdomainSearchModifier;
    } & BulkLookupOptions,
  ): Promise<BulkHostnameRow[]>;
  lookupCnameSources(params: { domain: string } & BulkLookupOptions): Promise<BulkHostnameRow[]>;
  hasBulkCnameSupport(): Promise<boolean>;
  lookupInfrastructureSummary(params: { domain: string }): Promise<BulkInfrastructureSummary>;
  lookupCtAlertSummary(): Promise<CtAlertSummary>;
  lookupCtAlerts(params: CtAlertLookupOptions): Promise<BulkCtAlertFeed>;
  listCtWatchlistEntries(): Promise<CtWatchlistEntry[]>;
  createCtWatchlistEntry(params: CtWatchlistCreateInput): Promise<CtWatchlistEntry>;
  updateCtWatchlistEntry(params: CtWatchlistUpdateInput): Promise<CtWatchlistEntry | null>;
  deleteCtWatchlistEntry(entryId: string): Promise<boolean>;
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

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  return value === 1 || value === "1" || value === "true";
}

function withOptionalLimit(query: string, limit?: number) {
  return typeof limit === "number" ? `${query}\n        LIMIT {limit: UInt64}\n      ` : query;
}

function normalizeSearchTerm(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replaceAll("*", "%").replace(/%+/g, "%");
}

function hasUnsupportedWildcard(value: string | undefined) {
  return (value ?? "").includes("%") || (value ?? "").includes("_");
}

function hasEffectiveSearchTerm(value: string) {
  return value.replaceAll("%", "").trim().length > 0;
}

function buildLikePattern(term: string, modifier: SubdomainSearchModifier = "contains") {
  if (!hasEffectiveSearchTerm(term)) {
    return null;
  }

  let pattern: string;

  switch (modifier) {
    case "starts_with":
      pattern = `${term}%`;
      break;
    case "ends_with":
      pattern = `%${term}`;
      break;
    case "contains":
      pattern = `%${term}%`;
      break;
  }

  return pattern.replace(/%+/g, "%");
}

function normalizeSubdomainLookupLimit(
  limit?: number,
  fallback = DEFAULT_SUBDOMAIN_LIMIT,
  max = 500,
) {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(limit), max);
}

export class ClickHouseBulkApiRepository implements BulkApiRepository {
  private readonly client: ClickHouseClientLike;

  constructor(options: ClickHouseBulkApiRepositoryOptions) {
    this.client = options.client;
  }

  async lookupReverseIp(params: { ip: string } & BulkLookupOptions): Promise<BulkHostnameRow[]> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: withOptionalLimit(
        `
        SELECT
          hostname,
          snapshot_month
        FROM bulk_active_reverse_ip_lookup
        WHERE ip_address = {ip_address: String}
        ORDER BY hostname ASC
      `,
        params.limit,
      ),
      queryParams: {
        ip_address: params.ip,
        ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      },
    });

    return rows.map((row) => ({
      hostname: String(row.hostname),
      snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
    }));
  }

  async lookupSubdomains(
    params: {
      scope: SubdomainSearchScope;
      domainTerm?: string;
      domainModifier?: SubdomainSearchModifier;
      subdomainTerm?: string;
      subdomainModifier?: SubdomainSearchModifier;
    } & BulkLookupOptions,
  ): Promise<BulkHostnameRow[]> {
    if (
      hasUnsupportedWildcard(params.domainTerm) ||
      hasUnsupportedWildcard(params.subdomainTerm)
    ) {
      throw new Error(INVALID_SUBDOMAIN_WILDCARD_ERROR);
    }

    const limit = normalizeSubdomainLookupLimit(params.limit);
    const domainPattern = buildLikePattern(
      normalizeSearchTerm(params.domainTerm),
      params.domainModifier,
    );
    const subdomainPattern = buildLikePattern(
      normalizeSearchTerm(params.subdomainTerm),
      params.subdomainModifier,
    );

    if (!domainPattern && !subdomainPattern) {
      throw new Error(
        "Enter at least one domain or subdomain search term to inspect subdomain infrastructure.",
      );
    }

    const filters = [
      params.scope === "domains"
        ? "hostname = apex_domain"
        : params.scope === "subdomains"
          ? "hostname != apex_domain"
          : null,
      domainPattern ? "apex_domain LIKE {domain_term: String}" : null,
      subdomainPattern ? "hostname LIKE {subdomain_term: String}" : null,
    ].filter((value): value is string => Boolean(value));

    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: withOptionalLimit(
        `
        SELECT
          hostname,
          apex_domain,
          snapshot_month
        FROM bulk_active_subdomain_lookup
        WHERE ${filters.join("\n          AND ")}
        ORDER BY hostname ASC
      `,
        limit,
      ),
      queryParams: {
        ...(domainPattern ? { domain_term: domainPattern } : {}),
        ...(subdomainPattern ? { subdomain_term: subdomainPattern } : {}),
        limit,
      },
    });

    return rows.map((row) => ({
      hostname: String(row.hostname),
      apexDomain: typeof row.apex_domain === "string" ? row.apex_domain : undefined,
      snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
    }));
  }

  async lookupCnameSources(
    params: { domain: string } & BulkLookupOptions,
  ): Promise<BulkHostnameRow[]> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: withOptionalLimit(
        `
        SELECT DISTINCT
          hostname,
          snapshot_month
        FROM bulk_active_hostname_serving
        WHERE cname_target = {cname_target: String}
          AND isNotNull(cname_target)
          AND cname_target != ''
        ORDER BY hostname ASC
      `,
        params.limit,
      ),
      queryParams: {
        cname_target: params.domain,
        ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
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

  async lookupCtAlertSummary(): Promise<CtAlertSummary> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT
          max(dump_date) AS newest_dump_date,
          count() AS alert_count,
          countIf(category = 'phishing') AS phishing_count,
          countIf(category = 'brand-protection') AS brand_protection_count,
          countIf(category = 'shadow-it') AS shadow_it_count,
          countIf(severity = 'high') AS high_severity_count
        FROM ct_active_alert_feed
      `,
    });

    const row = rows[0];

    return {
      newestDumpDate:
        typeof row?.newest_dump_date === "string" && row.newest_dump_date.length > 0
          ? row.newest_dump_date
          : null,
      totals: {
        alerts: parseRequiredNumber(row?.alert_count ?? 0, "alert_count"),
        phishing: parseRequiredNumber(row?.phishing_count ?? 0, "phishing_count"),
        brandProtection: parseRequiredNumber(
          row?.brand_protection_count ?? 0,
          "brand_protection_count",
        ),
        shadowIt: parseRequiredNumber(row?.shadow_it_count ?? 0, "shadow_it_count"),
        highSeverity: parseRequiredNumber(
          row?.high_severity_count ?? 0,
          "high_severity_count",
        ),
      },
    };
  }

  async lookupCtAlerts(params: CtAlertLookupOptions): Promise<BulkCtAlertFeed> {
    const filters = [
      params.category ? "category = {category: String}" : null,
      params.severity ? "severity = {severity: String}" : null,
      params.watchType ? "watch_type = {watch_type: String}" : null,
      params.dumpDate ? "dump_date = {dump_date: Date}" : null,
    ].filter((value): value is string => Boolean(value));

    const whereClause =
      filters.length > 0 ? `WHERE ${filters.join("\n          AND ")}` : "";
    const queryParams = {
      limit: params.limit,
      offset: params.offset,
      ...(params.category ? { category: params.category } : {}),
      ...(params.severity ? { severity: params.severity } : {}),
      ...(params.watchType ? { watch_type: params.watchType } : {}),
      ...(params.dumpDate ? { dump_date: params.dumpDate } : {}),
    };

    const [rows, totalRows] = await Promise.all([
      readRows<Record<string, unknown>>(this.client, {
        query: `
          SELECT
            alert_id,
            toString(dump_date) AS dump_date,
            domain,
            category,
            severity,
            watch_type,
            matched_term,
            reasons,
            issuer_name
          FROM ct_active_alert_feed
          ${whereClause}
          ORDER BY dump_date DESC, severity ASC, domain ASC, alert_id ASC
          LIMIT {limit: UInt64}
          OFFSET {offset: UInt64}
        `,
        queryParams,
      }),
      readRows<Record<string, unknown>>(this.client, {
        query: `
          SELECT count() AS total_count
          FROM ct_active_alert_feed
          ${whereClause}
        `,
        queryParams: {
          ...(params.category ? { category: params.category } : {}),
          ...(params.severity ? { severity: params.severity } : {}),
          ...(params.watchType ? { watch_type: params.watchType } : {}),
          ...(params.dumpDate ? { dump_date: params.dumpDate } : {}),
        },
      }),
    ]);

    return {
      results: rows.map((row) => ({
        id: String(row.alert_id),
        observedAt: String(row.dump_date),
        domain: String(row.domain),
        category: String(row.category) as CtAlertCategory,
        severity: String(row.severity) as CtAlertSeverity,
        watchType: String(row.watch_type) as CtWatchType,
        matchedTerm: String(row.matched_term),
        reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
        issuerName:
          typeof row.issuer_name === "string" && row.issuer_name.length > 0
            ? row.issuer_name
            : null,
      })),
      total: parseRequiredNumber(totalRows[0]?.total_count ?? 0, "total_count"),
    };
  }

  async listCtWatchlistEntries(): Promise<CtWatchlistEntry[]> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT
          toString(entry_id) AS entry_id,
          watch_type,
          term,
          enabled,
          toString(created_at) AS created_at,
          toString(updated_at) AS updated_at
        FROM ct_watchlist_entry FINAL
        ORDER BY enabled DESC, watch_type ASC, term ASC, entry_id ASC
      `,
    });

    return rows.map((row) => ({
      entryId: String(row.entry_id),
      watchType: String(row.watch_type) as CtWatchType,
      term: String(row.term),
      enabled: normalizeBoolean(row.enabled),
      createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
    }));
  }

  async createCtWatchlistEntry(params: CtWatchlistCreateInput): Promise<CtWatchlistEntry> {
    const now = new Date().toISOString();
    const entryId = randomUUID();

    await this.client.insert({
      table: "ct_watchlist_entry",
      values: [
        {
          entry_id: entryId,
          watch_type: params.watchType,
          term: params.term,
          enabled: params.enabled,
          created_at: now,
          updated_at: now,
        },
      ],
      format: "JSONEachRow",
    });

    return {
      entryId,
      watchType: params.watchType,
      term: params.term,
      enabled: params.enabled,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateCtWatchlistEntry(params: CtWatchlistUpdateInput): Promise<CtWatchlistEntry | null> {
    const currentEntry = await this.lookupCtWatchlistEntryById(params.entryId);

    if (!currentEntry) {
      return null;
    }

    const updatedAt = new Date().toISOString();
    const nextEntry = {
      entryId: currentEntry.entryId,
      watchType: params.watchType ?? currentEntry.watchType,
      term: params.term ?? currentEntry.term,
      enabled: params.enabled ?? currentEntry.enabled,
      createdAt: currentEntry.createdAt ?? updatedAt,
      updatedAt,
    };

    await this.client.insert({
      table: "ct_watchlist_entry",
      values: [
        {
          entry_id: nextEntry.entryId,
          watch_type: nextEntry.watchType,
          term: nextEntry.term,
          enabled: nextEntry.enabled,
          created_at: nextEntry.createdAt,
          updated_at: nextEntry.updatedAt,
        },
      ],
      format: "JSONEachRow",
    });

    return nextEntry;
  }

  async deleteCtWatchlistEntry(entryId: string): Promise<boolean> {
    const existingEntry = await this.lookupCtWatchlistEntryById(entryId);

    if (!existingEntry) {
      return false;
    }

    await this.client.command({
      query: `
        ALTER TABLE ct_watchlist_entry
        DELETE WHERE entry_id = toUUID({entry_id: String})
      `,
      query_params: {
        entry_id: entryId,
      },
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });

    return true;
  }

  private async lookupCtWatchlistEntryById(entryId: string): Promise<CtWatchlistEntry | null> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT
          toString(entry_id) AS entry_id,
          watch_type,
          term,
          enabled,
          toString(created_at) AS created_at,
          toString(updated_at) AS updated_at
        FROM ct_watchlist_entry FINAL
        WHERE entry_id = toUUID({entry_id: String})
        LIMIT 1
      `,
      queryParams: {
        entry_id: entryId,
      },
    });

    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      entryId: String(row.entry_id),
      watchType: String(row.watch_type) as CtWatchType,
      term: String(row.term),
      enabled: normalizeBoolean(row.enabled),
      createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
    };
  }
}
