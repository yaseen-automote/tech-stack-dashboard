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

export type SubdomainFilter = {
  id: string;
  term: string;
  modifier: "starts" | "ends" | "contains" | "exact";
  include: boolean;
};

export type SubdomainLookupParams = {
  scope: SubdomainSearchScope;
  filters: SubdomainFilter[];
  domainFilters?: SubdomainFilter[];
  subdomainFilters?: SubdomainFilter[];
  addedSince?: string;
  limit?: number;
  offset?: number;
};
// No default limit - show all results
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

export type CtIngestionSummaryRow = {
  dumpDate: string;
  status: string;
  rowCount: number;
  ingestedAt: string;
  errorMessage: string | null;
};

type CtAlertLookupOptions = {
  limit: number;
  offset?: number;
  category?: CtAlertCategory;
  severity?: CtAlertSeverity;
  watchType?: CtWatchType;
  dumpDate?: string;
};

type CtWatchlistCreateInput = {
  watchType: CtWatchType;
  term: string;
  enabled: boolean;
  typos: boolean;
  createdBy: string;
};

type CtWatchlistUpdateInput = {
  entryId: string;
  watchType?: CtWatchType;
  term?: string;
  enabled?: boolean;
  typos?: boolean;
  actor: string;
};

export class CtWatchlistPermissionError extends Error {
  constructor(message = "You can only manage watchlist terms you created.") {
    super(message);
    this.name = "CtWatchlistPermissionError";
  }
}

export type ConnectedDomainsResult = {
  results: BulkHostnameRow[];
  total: number;
};

export interface BulkApiRepository {
  lookupReverseIp(params: { ip: string; includeInactive?: boolean } & BulkLookupOptions): Promise<BulkHostnameRow[]>;
  lookupSubdomains(params: SubdomainLookupParams): Promise<BulkHostnameRow[]>;
  lookupConnectedDomains(params: { domain: string } & BulkLookupOptions): Promise<ConnectedDomainsResult>;
  lookupCnameSources(params: { domain: string } & BulkLookupOptions): Promise<BulkHostnameRow[]>;
  hasBulkCnameSupport(): Promise<boolean>;
  lookupInfrastructureSummary(params: { domain: string }): Promise<BulkInfrastructureSummary>;
  lookupCtAlertSummary(params?: {
    category?: CtAlertCategory;
    severity?: CtAlertSeverity;
    watchType?: CtWatchType;
  }): Promise<CtAlertSummary>;
  lookupCtAlerts(params: CtAlertLookupOptions): Promise<BulkCtAlertFeed>;
  exportCtAlerts(params: CtAlertLookupOptions): Promise<BulkCtAlertFeedRow[]>;
  lookupCtIngestionSummary(): Promise<CtIngestionSummaryRow[]>;
  listCtWatchlistEntries(): Promise<CtWatchlistEntry[]>;
  createCtWatchlistEntry(params: CtWatchlistCreateInput): Promise<CtWatchlistEntry>;
  updateCtWatchlistEntry(params: CtWatchlistUpdateInput): Promise<CtWatchlistEntry | null>;
  deleteCtWatchlistEntry(entryId: string, actor: string): Promise<boolean>;
  checkDomainExists(domain: string): Promise<{ exists: boolean; hostnameCount: number }>;
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

function clickhouseDatetime(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const CLICKHOUSE_DATETIME64_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

function normalizeRecordedAtForClickHouse(recordedAt: string) {
  if (CLICKHOUSE_DATETIME64_PATTERN.test(recordedAt)) {
    return recordedAt;
  }

  const parsedDate = new Date(recordedAt);

  if (Number.isNaN(parsedDate.getTime())) {
    return clickhouseDatetime();
  }

  const pad = (value: number, width = 2) => String(value).padStart(width, "0");

  return [
    `${parsedDate.getUTCFullYear()}-${pad(parsedDate.getUTCMonth() + 1)}-${pad(parsedDate.getUTCDate())}`,
    `${pad(parsedDate.getUTCHours())}:${pad(parsedDate.getUTCMinutes())}:${pad(parsedDate.getUTCSeconds())}.${pad(parsedDate.getUTCMilliseconds(), 3)}`,
  ].join(" ");
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

function normalizePositiveInteger(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.trunc(value);
}

function normalizePositiveIntegerWithFallback(value: number | undefined, fallback: number) {
  return normalizePositiveInteger(value) ?? fallback;
}

function normalizeNonNegativeOffset(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.trunc(value);
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

function buildWildcardPattern(term: string, modifier: SubdomainFilter["modifier"]): { pattern: string; operator: string } {
  const normalized = normalizeSearchTerm(term);

  switch (modifier) {
    case "exact":
      return { pattern: normalized, operator: "=" };
    case "contains":
      return { pattern: `%${normalized}%`, operator: "LIKE" };
    case "starts":
      return { pattern: `${normalized}%`, operator: "LIKE" };
    case "ends":
      return { pattern: `%${normalized}`, operator: "LIKE" };
  }
}

function normalizeSubdomainLookupLimit(
  limit?: number,
  max = 10000,
) {
  const normalizedLimit = normalizePositiveInteger(limit);

  if (typeof normalizedLimit !== "number") {
    return max;
  }

  return Math.min(normalizedLimit, max);
}

function normalizeAddedSinceMonth(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmedValue = value.trim();
  const match = trimmedValue.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T\s].*)?$/);

  if (!match) {
    throw new Error("Enter a valid addedSince date to filter discovery results.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = typeof match[3] === "string" ? Number(match[3]) : undefined;

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Enter a valid addedSince date to filter discovery results.");
  }

  if (typeof day === "number") {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
      throw new Error("Enter a valid addedSince date to filter discovery results.");
    }
  }

  return day ? `${match[1]}-${match[2]}-${match[3]}` : `${match[1]}-${match[2]}-01`;
}

function reverseLookupValue(value: string) {
  return value.split("").reverse().join("");
}

function buildLookupCondition(
  column: string,
  reversedColumn: string,
  searchColumn: string,
  filter: SubdomainFilter,
  paramKey: string,
  params: Record<string, unknown>,
) {
  const normalized = normalizeSearchTerm(filter.term);

  switch (filter.modifier) {
    case "exact":
      params[paramKey] = normalized;
      return `${column} = {${paramKey}:String}`;
    case "starts":
      params[paramKey] = `${normalized}%`;
      return `${column} LIKE {${paramKey}:String}`;
    case "ends":
      params[paramKey] = `${reverseLookupValue(normalized)}%`;
      return `${reversedColumn} LIKE {${paramKey}:String}`;
    case "contains":
      params[paramKey] = `%${normalized}%`;
      return `${searchColumn} LIKE {${paramKey}:String}`;
  }
}

function buildHostnameServingLookupCondition(
  column: string,
  filter: SubdomainFilter,
  paramKey: string,
  params: Record<string, unknown>,
) {
  const normalized = normalizeSearchTerm(filter.term);

  switch (filter.modifier) {
    case "exact":
      params[paramKey] = normalized;
      return `${column} = {${paramKey}:String}`;
    case "starts":
      params[paramKey] = `${normalized}%`;
      return `${column} LIKE {${paramKey}:String}`;
    case "ends":
      params[paramKey] = `%${normalized}`;
      return `${column} LIKE {${paramKey}:String}`;
    case "contains":
      if (normalized.includes(".") && column === "apex_domain") {
        params[paramKey] = normalized;
        return `${column} = {${paramKey}:String}`;
      }
      params[paramKey] = `%${normalized}%`;
      return `${column} LIKE {${paramKey}:String}`;
  }
}

export class ClickHouseBulkApiRepository implements BulkApiRepository {
  private readonly client: ClickHouseClientLike;
  private watchlistColumnsEnsured = false;

  constructor(options: ClickHouseBulkApiRepositoryOptions) {
    this.client = options.client;
  }

  async lookupReverseIp(params: { ip: string; includeInactive?: boolean } & BulkLookupOptions): Promise<BulkHostnameRow[]> {
    const livenessFilter = params.includeInactive
      ? ""
      : "AND (status.is_functional IS NULL OR status.is_functional != 0)";
    const limit = normalizePositiveInteger(params.limit);

    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: withOptionalLimit(
        `
        SELECT
          lookup.hostname,
          lookup.snapshot_month
        FROM bulk_active_reverse_ip_lookup AS lookup
        LEFT JOIN domain_liveness_status AS status ON lookup.hostname = status.hostname
        WHERE lookup.ip_address = {ip_address: String}
        ${livenessFilter}
        ORDER BY lookup.hostname ASC
      `,
        limit,
      ),
      queryParams: {
        ip_address: params.ip,
        ...(typeof limit === "number" ? { limit } : {}),
      },
    });

    return rows.map((row) => ({
      hostname: String(row.hostname),
      snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
    }));
  }

  private buildHostnameServingApexQuery(
    domainFilters: SubdomainFilter[],
    addedSince?: string,
    paramPrefix?: string,
  ): { query: string; params: Record<string, unknown> } {
    const params: Record<string, unknown> = {};
    const conditions: string[] = [];
    const prefix = paramPrefix ?? "";

    conditions.push("is_functional != 0");

    const addedSinceMonth = normalizeAddedSinceMonth(addedSince);
    if (addedSinceMonth) {
      params.addedSince = addedSinceMonth;
      conditions.push("toDate(loaded_at) >= toDate({addedSince:String})");
    }

    const includeConditions: string[] = [];
    const excludeConditions: string[] = [];

    for (let i = 0; i < domainFilters.length; i++) {
      const filter = domainFilters[i];
      const paramKey = `${prefix}term_${i}`;
      const condition = buildHostnameServingLookupCondition(
        "apex_domain",
        filter,
        paramKey,
        params,
      );
      if (filter.include) {
        includeConditions.push(condition);
      } else {
        excludeConditions.push(condition);
      }
    }

    if (includeConditions.length > 0) {
      conditions.push(
        includeConditions.length === 1
          ? includeConditions[0]
          : `(${includeConditions.join("\n          OR ")})`,
      );
    }
    for (const cond of excludeConditions) {
      conditions.push(`NOT (${cond})`);
    }

    return {
      query: `
        SELECT DISTINCT
          apex_domain AS hostname,
          apex_domain AS apex_domain
        FROM bulk_active_hostname_serving
        WHERE ${conditions.join("\n        AND ")}`,
      params,
    };
  }

  private buildHostnameServingSubdomainQuery(
    subdomainFilters: SubdomainFilter[],
    domainFilters?: SubdomainFilter[],
    addedSince?: string,
  ): { query: string; params: Record<string, unknown> } {
    const params: Record<string, unknown> = {};
    const conditions: string[] = [];

    conditions.push("is_functional != 0");

    const addedSinceMonth = normalizeAddedSinceMonth(addedSince);
    if (addedSinceMonth) {
      params.addedSince = addedSinceMonth;
      conditions.push("toDate(loaded_at) >= toDate({addedSince:String})");
    }

    const includeGroups: string[][] = [];
    const excludeGroups: string[][] = [];

    for (let i = 0; i < subdomainFilters.length; i++) {
      const filter = subdomainFilters[i];
      const paramKey = `term_${i}`;
      const condition = buildHostnameServingLookupCondition(
        "hostname",
        filter,
        paramKey,
        params,
      );
      const normalized = normalizeSearchTerm(filter.term);

      const group: string[] = [condition];
      if (normalized.includes(".")) {
        const parentKey = `parent_domain_${i}`;
        params[parentKey] = normalized;
        group.push(`apex_domain = {${parentKey}:String}`);
      }

      if (filter.include) {
        includeGroups.push(group);
      } else {
        excludeGroups.push(group);
      }
    }

    if (includeGroups.length > 0) {
      const orParts = includeGroups.map(
        g => g.length === 1 ? g[0] : `(${g.join("\n          AND ")})`,
      );
      conditions.push(
        orParts.length === 1 ? orParts[0] : `(${orParts.join("\n          OR ")})`,
      );
    }
    for (const group of excludeGroups) {
      const expr = group.length === 1 ? group[0] : `(${group.join("\n          AND ")})`;
      conditions.push(`NOT (${expr})`);
    }

    if (domainFilters && domainFilters.length > 0) {
      const domInclude: string[] = [];
      const domExclude: string[] = [];

      for (let i = 0; i < domainFilters.length; i++) {
        const filter = domainFilters[i];
        const paramKey = `dom_term_${i}`;
        const condition = buildHostnameServingLookupCondition(
          "apex_domain",
          filter,
          paramKey,
          params,
        );
        if (filter.include) {
          domInclude.push(condition);
        } else {
          domExclude.push(condition);
        }
      }

      if (domInclude.length > 0) {
        conditions.push(
          domInclude.length === 1
            ? domInclude[0]
            : `(${domInclude.join("\n          OR ")})`,
        );
      }
      for (const cond of domExclude) {
        conditions.push(`NOT (${cond})`);
      }
    }

    return {
      query: `
        SELECT DISTINCT
          hostname,
          apex_domain
        FROM bulk_active_hostname_serving
        WHERE ${conditions.join("\n        AND ")}`,
      params,
    };
  }

  async lookupSubdomains(params: SubdomainLookupParams): Promise<BulkHostnameRow[]> {
    const domainActiveFilters =
      params.scope === "subdomains"
        ? []
        : params.scope === "both" && params.domainFilters
          ? params.domainFilters.filter((f) => f.term.replaceAll("*", "").trim().length > 0)
          : params.filters.filter((f) => f.term.replaceAll("*", "").trim().length > 0);

    const subdomainActiveFilters =
      params.scope === "domains"
        ? []
        : params.scope === "both" && params.subdomainFilters
          ? params.subdomainFilters.filter((f) => f.term.replaceAll("*", "").trim().length > 0)
          : params.scope === "subdomains"
            ? params.filters.filter((f) => f.term.replaceAll("*", "").trim().length > 0)
            : [];

    const allFilters = [...domainActiveFilters, ...subdomainActiveFilters];

    if (allFilters.length === 0) {
      throw new Error("Enter at least one search term to inspect subdomain infrastructure.");
    }

    for (const filter of allFilters) {
      if (filter.term.includes("%") || filter.term.includes("_")) {
        throw new Error(INVALID_SUBDOMAIN_WILDCARD_ERROR);
      }
    }

    const limit = normalizeSubdomainLookupLimit(params.limit);
    const offset = normalizeNonNegativeOffset(params.offset);

    let query: string;
    let queryParams: Record<string, unknown>;

    if (params.scope === "domains") {
      const apexResult = this.buildHostnameServingApexQuery(domainActiveFilters, params.addedSince);
      query = `
      ${apexResult.query}
      ORDER BY hostname ASC
      LIMIT {limit: UInt64}
      OFFSET {offset: UInt64}
    `;
      queryParams = {
        ...apexResult.params,
        limit,
        offset,
      };
    } else if (params.scope === "subdomains") {
      const subdomainResult = this.buildHostnameServingSubdomainQuery(subdomainActiveFilters, undefined, params.addedSince);
      query = `
      ${subdomainResult.query}
      ORDER BY hostname ASC
      LIMIT {limit: UInt64}
      OFFSET {offset: UInt64}
    `;
      queryParams = {
        ...subdomainResult.params,
        limit,
        offset,
      };
    } else if (subdomainActiveFilters.length > 0 && domainActiveFilters.length > 0) {
      const combinedResult = this.buildHostnameServingSubdomainQuery(
        subdomainActiveFilters,
        domainActiveFilters,
        params.addedSince,
      );
      query = `
        ${combinedResult.query}
        ORDER BY hostname ASC
        LIMIT {limit: UInt64}
        OFFSET {offset: UInt64}
      `;
      queryParams = {
        ...combinedResult.params,
        limit,
        offset,
      };
    } else {
      const subFilters = subdomainActiveFilters.length > 0
        ? subdomainActiveFilters
        : domainActiveFilters;
      const apexResult = this.buildHostnameServingApexQuery(domainActiveFilters, params.addedSince, "apex_");
      const subdomainResult = this.buildHostnameServingSubdomainQuery(
        subFilters,
        subdomainActiveFilters.length > 0 ? domainActiveFilters : undefined,
        params.addedSince,
      );

      const halfLimit = Math.ceil(limit / 2);
      const restLimit = limit - halfLimit;

      const apexQuery = `${apexResult.query}\n        ORDER BY hostname ASC\n        LIMIT {apex_limit: UInt64}`;
      const subdomainQuery = `${subdomainResult.query}\n        ORDER BY hostname ASC\n        LIMIT {sub_limit: UInt64}`;

      const [apexRows, subdomainRows] = await Promise.all([
        readRows<Record<string, unknown>>(this.client, {
          query: apexQuery,
          queryParams: { ...apexResult.params, apex_limit: halfLimit + offset },
        }),
        readRows<Record<string, unknown>>(this.client, {
          query: subdomainQuery,
          queryParams: { ...subdomainResult.params, sub_limit: restLimit + offset },
        }),
      ]);

      const seen = new Set<string>();
      const dedupedApex: BulkHostnameRow[] = [];
      const dedupedSub: BulkHostnameRow[] = [];

      for (const row of apexRows) {
        const hostname = String(row.hostname).trim().toLowerCase();

        if (!hostname || seen.has(hostname)) {
          continue;
        }

        seen.add(hostname);
        dedupedApex.push({
          hostname,
          apexDomain: typeof row.apex_domain === "string" ? row.apex_domain : undefined,
          snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
        });
      }

      for (const row of subdomainRows) {
        const hostname = String(row.hostname).trim().toLowerCase();

        if (!hostname || seen.has(hostname)) {
          continue;
        }

        seen.add(hostname);
        dedupedSub.push({
          hostname,
          apexDomain: typeof row.apex_domain === "string" ? row.apex_domain : undefined,
          snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
        });
      }

      return [
        ...dedupedApex.slice(offset, offset + halfLimit),
        ...dedupedSub.slice(offset, offset + restLimit),
      ];
    }

    const rows = await readRows<Record<string, unknown>>(this.client, {
      query,
      queryParams,
    });

    return rows.map((row) => ({
      hostname: String(row.hostname),
      apexDomain: typeof row.apex_domain === "string" ? row.apex_domain : undefined,
      snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
    }));
  }

  async lookupConnectedDomains(
    params: { domain: string } & BulkLookupOptions,
  ): Promise<ConnectedDomainsResult> {
    const ipRows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT DISTINCT ip_address
        FROM bulk_active_hostname_serving
        WHERE apex_domain = {apex_domain: String}
        LIMIT 20
      `,
      queryParams: {
        apex_domain: params.domain,
      },
    });

    if (ipRows.length === 0) {
      return { results: [], total: 0 };
    }

    const ips = ipRows.map((row) => String(row.ip_address));
    const limit = normalizePositiveIntegerWithFallback(params.limit, 500);

    if (ips.length === 1) {
      const [dataRows, countRows] = await Promise.all([
        readRows<Record<string, unknown>>(this.client, {
          query: `
            SELECT hostname, snapshot_month
            FROM bulk_active_reverse_ip_lookup
            WHERE ip_address = {ip_address: String}
            ORDER BY hostname ASC
            LIMIT {limit: UInt64}
          `,
          queryParams: {
            ip_address: ips[0],
            limit,
          },
        }),
        readRows<Record<string, unknown>>(this.client, {
          query: `
            SELECT count() AS total_count
            FROM bulk_active_reverse_ip_lookup
            WHERE ip_address = {ip_address: String}
          `,
          queryParams: {
            ip_address: ips[0],
          },
        }),
      ]);

      return {
        results: dataRows.map((row) => ({
          hostname: String(row.hostname),
          snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
        })),
        total: parseRequiredNumber(countRows[0]?.total_count ?? 0, "total_count"),
      };
    }

    const ipParams: Record<string, string> = {};
    const ipConditions = ips.map((ip, index) => {
      const key = `ip_${index}`;
      ipParams[key] = ip;
      return `ip_address = {${key}: String}`;
    });

    const [dataRows, countRows] = await Promise.all([
      readRows<Record<string, unknown>>(this.client, {
        query: `
          SELECT DISTINCT hostname, snapshot_month
          FROM bulk_active_reverse_ip_lookup
          WHERE ${ipConditions.join("\n          OR ")}
          ORDER BY hostname ASC
          LIMIT {limit: UInt64}
        `,
        queryParams: {
          ...ipParams,
          limit,
        },
      }),
      readRows<Record<string, unknown>>(this.client, {
        query: `
          SELECT count() AS total_count
          FROM (
            SELECT DISTINCT hostname, snapshot_month
            FROM bulk_active_reverse_ip_lookup
            WHERE ${ipConditions.join("\n            OR ")}
          )
        `,
        queryParams: {
          ...ipParams,
        },
      }),
    ]);

    return {
      results: dataRows.map((row) => ({
        hostname: String(row.hostname),
        snapshotMonth: normalizeSnapshotMonth(row.snapshot_month),
      })),
      total: parseRequiredNumber(countRows[0]?.total_count ?? 0, "total_count"),
    };
  }

  async lookupCnameSources(
    params: { domain: string } & BulkLookupOptions,
  ): Promise<BulkHostnameRow[]> {
    const limit = normalizePositiveInteger(params.limit);

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
        limit,
      ),
      queryParams: {
        cname_target: params.domain,
        ...(typeof limit === "number" ? { limit } : {}),
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

  async lookupCtAlertSummary(params?: {
    category?: CtAlertCategory;
    severity?: CtAlertSeverity;
    watchType?: CtWatchType;
  }): Promise<CtAlertSummary> {
    const filters = [
      params?.category ? "category = {category: String}" : null,
      params?.severity ? "severity = {severity: String}" : null,
      params?.watchType ? "watch_type = {watch_type: String}" : null,
    ].filter((value): value is string => Boolean(value));

    const whereClause = filters.length > 0 ? `WHERE ${filters.join("\n          AND ")}` : "";

    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT
          max(dump_date) AS newest_dump_date,
          count() AS alert_count,
          countIf(category = 'phishing') AS phishing_count,
          countIf(category = 'brand-protection') AS brand_protection_count,
          countIf(category = 'shadow-it') AS shadow_it_count,
          countIf(category = 'typosquatting') AS typosquatting_count,
          countIf(severity = 'high') AS high_severity_count
        FROM ct_active_alert_feed
        ${whereClause}
      `,
      queryParams: {
        ...(params?.category ? { category: params.category } : {}),
        ...(params?.severity ? { severity: params.severity } : {}),
        ...(params?.watchType ? { watch_type: params.watchType } : {}),
      },
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
        typosquatting: parseRequiredNumber(row?.typosquatting_count ?? 0, "typosquatting_count"),
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
      offset: params.offset ?? 0,
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

  async exportCtAlerts(params: CtAlertLookupOptions): Promise<BulkCtAlertFeedRow[]> {
    const filters = [
      params.category ? "category = {category: String}" : null,
      params.severity ? "severity = {severity: String}" : null,
      params.watchType ? "watch_type = {watch_type: String}" : null,
      params.dumpDate ? "dump_date = {dump_date: Date}" : null,
    ].filter((value): value is string => Boolean(value));

    const whereClause =
      filters.length > 0 ? `WHERE ${filters.join("\n          AND ")}` : "";
    const queryParams = {
      limit: Math.min(params.limit, 5000),
      ...(params.category ? { category: params.category } : {}),
      ...(params.severity ? { severity: params.severity } : {}),
      ...(params.watchType ? { watch_type: params.watchType } : {}),
      ...(params.dumpDate ? { dump_date: params.dumpDate } : {}),
    };

    const rows = await readRows<Record<string, unknown>>(this.client, {
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
      `,
      queryParams,
    });

    return rows.map((row) => ({
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
    }));
  }

  async lookupCtIngestionSummary(): Promise<CtIngestionSummaryRow[]> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT
          toString(dump_date) as dumpDate,
          status,
          row_count as rowCount,
          formatDateTime(recorded_at, '%Y-%m-%d %H:%i:%S', 'UTC') as ingestedAt,
          error_message as errorMessage
        FROM tech_stack_bulk.ct_import_attempt_events
        WHERE status = 'ready'
        ORDER BY recorded_at DESC
        LIMIT 50
      `,
    });

    return rows.map((row) => ({
      dumpDate: String(row.dumpDate),
      status: String(row.status),
      rowCount: parseRequiredNumber(row.rowCount ?? 0, "rowCount"),
      ingestedAt: String(row.ingestedAt),
      errorMessage:
        typeof row.errorMessage === "string" && row.errorMessage.length > 0
          ? row.errorMessage
          : null,
    }));
  }

  private async ensureCtWatchlistColumns() {
    if (this.watchlistColumnsEnsured) {
      return;
    }

    await this.client.command({
      query: `
        ALTER TABLE ct_watchlist_entry
        ADD COLUMN IF NOT EXISTS created_by Nullable(String)
      `,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });

    this.watchlistColumnsEnsured = true;
  }

  async listCtWatchlistEntries(): Promise<CtWatchlistEntry[]> {
    await this.ensureCtWatchlistColumns();

    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT
          toString(entry_id) AS entry_id_text,
          watch_type,
          term,
          enabled,
          typos,
          created_by,
          toString(created_at) AS created_at,
          toString(updated_at) AS updated_at
        FROM ct_watchlist_entry FINAL
        ORDER BY enabled DESC, watch_type ASC, term ASC, entry_id ASC
      `,
    });

    return rows.map((row) => ({
      entryId: String(row.entry_id_text),
      watchType: String(row.watch_type) as CtWatchType,
      term: String(row.term),
      enabled: normalizeBoolean(row.enabled),
      typos: normalizeBoolean(row.typos),
      createdBy: typeof row.created_by === "string" ? row.created_by : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
    }));
  }

  async createCtWatchlistEntry(params: CtWatchlistCreateInput): Promise<CtWatchlistEntry> {
    await this.ensureCtWatchlistColumns();

    const now = normalizeRecordedAtForClickHouse(clickhouseDatetime());
    const entryId = randomUUID();

    await this.client.insert({
      table: "ct_watchlist_entry",
      values: [
        {
          entry_id: entryId,
          watch_type: params.watchType,
          term: params.term,
          enabled: params.enabled,
          typos: params.typos,
          created_by: params.createdBy,
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
      typos: params.typos,
      createdBy: params.createdBy,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateCtWatchlistEntry(params: CtWatchlistUpdateInput): Promise<CtWatchlistEntry | null> {
    await this.ensureCtWatchlistColumns();

    const currentEntry = await this.lookupCtWatchlistEntryById(params.entryId);

    if (!currentEntry) {
      return null;
    }

    const updatedAt = normalizeRecordedAtForClickHouse(clickhouseDatetime());
    const nextEntry = {
      entryId: currentEntry.entryId,
      watchType: params.watchType ?? currentEntry.watchType,
      term: params.term ?? currentEntry.term,
      enabled: params.enabled ?? currentEntry.enabled,
      typos: params.typos ?? currentEntry.typos,
      createdBy: currentEntry.createdBy ?? params.actor,
      createdAt: normalizeRecordedAtForClickHouse(currentEntry.createdAt ?? updatedAt),
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
          typos: nextEntry.typos,
          created_by: nextEntry.createdBy,
          created_at: nextEntry.createdAt,
          updated_at: nextEntry.updatedAt,
        },
      ],
      format: "JSONEachRow",
    });

    return nextEntry;
  }

  async deleteCtWatchlistEntry(entryId: string, actor: string): Promise<boolean> {
    await this.ensureCtWatchlistColumns();

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
    await this.ensureCtWatchlistColumns();

    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT
          toString(entry_id) AS entry_id_text,
          watch_type,
          term,
          enabled,
          typos,
          created_by,
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
      entryId: String(row.entry_id_text),
      watchType: String(row.watch_type) as CtWatchType,
      term: String(row.term),
      enabled: normalizeBoolean(row.enabled),
      typos: normalizeBoolean(row.typos),
      createdBy: typeof row.created_by === "string" ? row.created_by : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
    };
  }

  async checkDomainExists(domain: string): Promise<{ exists: boolean; hostnameCount: number }> {
    const rows = await readRows<Record<string, unknown>>(this.client, {
      query: `
        SELECT count(DISTINCT hostname) AS count
        FROM bulk_active_hostname_serving
        WHERE apex_domain = {domain:String}
      `,
      queryParams: {
        domain,
      },
    });

    const count = parseRequiredNumber(rows[0]?.count, "count");
    return { exists: count > 0, hostnameCount: count };
  }
}
