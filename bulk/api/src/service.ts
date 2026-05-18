import {
  classifySubdomain,
  normalizeDomainInput,
  type SubdomainRecord,
} from "@/lib/subdomain-intelligence";
import type {
  CtAlertCategory,
  CtAlertSeverity,
  CtAlertSummary,
  CtWatchType,
  CtWatchlistEntry,
} from "@/ct/types";

import type { BulkApiConfig } from "./config";
import type {
  BulkCtAlertFeed,
  BulkCtAlertFeedRow,
  BulkApiRepository,
  BulkHostnameRow,
  BulkInfrastructureSummary,
} from "./repository";

type FetchLike = typeof fetch;

type SourceKind = "bulk" | "upstream";
type SubdomainSearchScope = "domains" | "subdomains" | "both";
type SubdomainSearchModifier = "starts_with" | "ends_with" | "contains";
const INVALID_SUBDOMAIN_WILDCARD_ERROR =
  "Use * as the only wildcard in domain and subdomain search terms.";

type LookupMetadata = {
  snapshotMonth?: string;
  source: SourceKind;
};

export type BulkReverseIpLookupResponse = {
  domain: string;
  results: SubdomainRecord[];
} & LookupMetadata;

export type BulkSubdomainLookupResponse = {
  domain: string;
  results: SubdomainRecord[];
} & LookupMetadata;

export type BulkCnameLookupResponse = {
  domain: string;
  results: SubdomainRecord[];
} & LookupMetadata;

export type BulkInfrastructureSummaryResponse = {
  domain: string;
  totals: BulkInfrastructureSummary["totals"];
  providers: BulkInfrastructureSummary["providers"];
  cnameTargets: BulkInfrastructureSummary["cnameTargets"];
} & LookupMetadata;

export type BulkCtAlertSummaryResponse = CtAlertSummary & {
  source: SourceKind;
};

export type BulkCtAlertFeedResponse = {
  results: BulkCtAlertFeedRow[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
  source: SourceKind;
};

export type BulkCtWatchlistResponse = {
  entries: CtWatchlistEntry[];
  source: SourceKind;
};

export type BulkCtWatchlistMutationResponse = {
  entry: CtWatchlistEntry;
  source: SourceKind;
};

export interface BulkApiLookupService {
  lookupReverseIp(params: { ip: string; limit: number }): Promise<BulkReverseIpLookupResponse>;
  lookupSubdomains(
    params: {
      scope: SubdomainSearchScope;
      domainTerm?: string;
      domainModifier?: SubdomainSearchModifier;
      subdomainTerm?: string;
      subdomainModifier?: SubdomainSearchModifier;
      limit?: number;
    },
  ): Promise<BulkSubdomainLookupResponse>;
  lookupCnames(params: { domain: string; limit?: number }): Promise<BulkCnameLookupResponse>;
  lookupInfrastructureSummary(
    params: { domain: string },
  ): Promise<BulkInfrastructureSummaryResponse>;
  lookupCtAlertSummary(): Promise<BulkCtAlertSummaryResponse>;
  lookupCtAlerts(params: {
    limit: number;
    offset: number;
    category?: CtAlertCategory;
    severity?: CtAlertSeverity;
    watchType?: CtWatchType;
    dumpDate?: string;
  }): Promise<BulkCtAlertFeedResponse>;
  listCtWatchlistEntries(): Promise<BulkCtWatchlistResponse>;
  createCtWatchlistEntry(params: {
    watchType: CtWatchType;
    term: string;
    enabled: boolean;
  }): Promise<BulkCtWatchlistMutationResponse>;
  updateCtWatchlistEntry(params: {
    entryId: string;
    watchType?: CtWatchType;
    term?: string;
    enabled?: boolean;
  }): Promise<BulkCtWatchlistMutationResponse | null>;
  deleteCtWatchlistEntry(entryId: string): Promise<boolean>;
}

type BulkApiLookupServiceOptions = {
  config: BulkApiConfig;
  repository: BulkApiRepository;
  fetch: FetchLike;
};

type UpstreamCnameItem =
  | string
  | {
      domain?: string;
      hostname?: string;
      name?: string;
      source_domain?: string;
      source_hostname?: string;
    };

type UpstreamCnamePayload =
  | UpstreamCnameItem[]
  | {
      results?: UpstreamCnameItem[];
      data?: UpstreamCnameItem[];
      domains?: UpstreamCnameItem[];
    };

function mapHostnamesToRecords(
  hostnames: string[],
  type: SubdomainRecord["type"],
  status: SubdomainRecord["status"],
) {
  return hostnames.map((subdomain, index) => ({
    id: `${subdomain}-${index}`,
    subdomain,
    type,
    status,
  }));
}

function uniqueHostnames(rows: BulkHostnameRow[]) {
  return [...new Set(rows.map((row) => row.hostname.trim().toLowerCase()).filter(Boolean))];
}

function firstSnapshotMonth(rows: BulkHostnameRow[]) {
  return rows.find((row) => row.snapshotMonth)?.snapshotMonth;
}

function buildSubdomainResults(rows: BulkHostnameRow[]) {
  const uniqueRows = new Map<string, BulkHostnameRow>();

  for (const row of rows) {
    const hostname = row.hostname.trim().toLowerCase();

    if (!hostname || uniqueRows.has(hostname)) {
      continue;
    }

    uniqueRows.set(hostname, {
      ...row,
      hostname,
      apexDomain: row.apexDomain?.trim().toLowerCase(),
    });
  }

  return [...uniqueRows.values()].map((row, index) => ({
    id: `${row.hostname}-${index}`,
    subdomain: row.hostname,
    ...classifySubdomain(row.hostname, row.apexDomain ?? row.hostname),
  }));
}

function normalizeCnameResult(item: UpstreamCnameItem) {
  if (typeof item === "string") {
    return normalizeDomainInput(item);
  }

  const candidate =
    item.source_domain ??
    item.source_hostname ??
    item.domain ??
    item.hostname ??
    item.name;

  return candidate ? normalizeDomainInput(candidate) : null;
}

function extractCnameResults(payload: UpstreamCnamePayload) {
  const items = Array.isArray(payload)
    ? payload
    : payload.results ?? payload.data ?? payload.domains ?? [];

  return [
    ...new Set(
      items
        .map((item) => normalizeCnameResult(item))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

async function fetchUpstreamCnames(
  config: BulkApiConfig,
  requestFetch: FetchLike,
  domain: string,
  limit?: number,
) {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain",
    "Content-Type": "application/json",
  };

  if (config.thc.apiKey) {
    headers.Authorization = `Bearer ${config.thc.apiKey}`;
  }

  const response = await requestFetch(`${config.thc.baseUrl}/api/v1/lookup/cnames`, {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify({
      target_domain: domain,
    }),
  });

  if (!response.ok) {
    throw new Error("The upstream CNAME dataset is unavailable right now.");
  }

  const payload = (await response.json()) as UpstreamCnamePayload;
  const hostnames = extractCnameResults(payload);

  return mapHostnamesToRecords(
    typeof limit === "number" ? hostnames.slice(0, limit) : hostnames,
    "CNAME",
    "Live",
  );
}

function normalizeWatchTerm(term: string) {
  return term.trim().toLowerCase();
}

function hasUnsupportedSubdomainWildcard(value: string | undefined) {
  return (value ?? "").includes("%") || (value ?? "").includes("_");
}

export function createBulkApiLookupService(
  options: BulkApiLookupServiceOptions,
): BulkApiLookupService {
  return {
    async lookupReverseIp({ ip, limit }) {
      const rows = await options.repository.lookupReverseIp({ ip, limit });

      return {
        domain: ip,
        results: mapHostnamesToRecords(uniqueHostnames(rows), "Reverse DNS", "Live"),
        snapshotMonth: firstSnapshotMonth(rows) ?? options.config.activeSnapshotMonth,
        source: "bulk",
      };
    },

    async lookupSubdomains({
      scope,
      domainTerm,
      domainModifier,
      subdomainTerm,
      subdomainModifier,
      limit,
    }) {
      if (
        hasUnsupportedSubdomainWildcard(domainTerm) ||
        hasUnsupportedSubdomainWildcard(subdomainTerm)
      ) {
        throw new Error(INVALID_SUBDOMAIN_WILDCARD_ERROR);
      }

      const rows = await options.repository.lookupSubdomains({
        scope,
        domainTerm,
        domainModifier,
        subdomainTerm,
        subdomainModifier,
        limit,
      });

      return {
        domain: "Domains & Subdomains Discovery",
        results: buildSubdomainResults(rows),
        snapshotMonth: firstSnapshotMonth(rows) ?? options.config.activeSnapshotMonth,
        source: "bulk",
      };
    },

    async lookupCnames({ domain, limit }) {
      const hasBulkSupport = await options.repository.hasBulkCnameSupport();

      if (hasBulkSupport) {
        const rows = await options.repository.lookupCnameSources({ domain, limit });

        return {
          domain,
          results: mapHostnamesToRecords(uniqueHostnames(rows), "CNAME", "Live"),
          snapshotMonth: firstSnapshotMonth(rows) ?? options.config.activeSnapshotMonth,
          source: "bulk",
        };
      }

      return {
        domain,
        results: await fetchUpstreamCnames(options.config, options.fetch, domain, limit),
        source: "upstream",
      };
    },

    async lookupInfrastructureSummary({ domain }) {
      const summary = await options.repository.lookupInfrastructureSummary({ domain });

      return {
        domain,
        snapshotMonth: summary.snapshotMonth ?? options.config.activeSnapshotMonth,
        source: "bulk",
        totals: summary.totals,
        providers: summary.providers,
        cnameTargets: summary.cnameTargets,
      };
    },

    async lookupCtAlertSummary() {
      const summary = await options.repository.lookupCtAlertSummary();

      return {
        ...summary,
        source: "bulk",
      };
    },

    async lookupCtAlerts({ limit, offset, category, severity, watchType, dumpDate }) {
      const response: BulkCtAlertFeed = await options.repository.lookupCtAlerts({
        limit,
        offset,
        category,
        severity,
        watchType,
        dumpDate,
      });

      return {
        results: response.results,
        pagination: {
          limit,
          offset,
          total: response.total,
        },
        source: "bulk",
      };
    },

    async listCtWatchlistEntries() {
      return {
        entries: await options.repository.listCtWatchlistEntries(),
        source: "bulk",
      };
    },

    async createCtWatchlistEntry({ watchType, term, enabled }) {
      return {
        entry: await options.repository.createCtWatchlistEntry({
          watchType,
          term: normalizeWatchTerm(term),
          enabled,
        }),
        source: "bulk",
      };
    },

    async updateCtWatchlistEntry({ entryId, watchType, term, enabled }) {
      const entry = await options.repository.updateCtWatchlistEntry({
        entryId,
        watchType,
        term: typeof term === "string" ? normalizeWatchTerm(term) : undefined,
        enabled,
      });

      if (!entry) {
        return null;
      }

      return {
        entry,
        source: "bulk",
      };
    },

    async deleteCtWatchlistEntry(entryId) {
      return options.repository.deleteCtWatchlistEntry(entryId);
    },
  };
}
