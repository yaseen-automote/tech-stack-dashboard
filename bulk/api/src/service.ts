import {
  classifySubdomain,
  normalizeDomainInput,
  type SubdomainRecord,
} from "@/lib/subdomain-intelligence";

import type { BulkApiConfig } from "./config";
import type {
  BulkApiRepository,
  BulkHostnameRow,
  BulkInfrastructureSummary,
} from "./repository";

type FetchLike = typeof fetch;

type SourceKind = "bulk" | "upstream";

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

export interface BulkApiLookupService {
  lookupReverseIp(params: { ip: string; limit: number }): Promise<BulkReverseIpLookupResponse>;
  lookupSubdomains(
    params: { domain: string; limit: number },
  ): Promise<BulkSubdomainLookupResponse>;
  lookupCnames(params: { domain: string; limit: number }): Promise<BulkCnameLookupResponse>;
  lookupInfrastructureSummary(
    params: { domain: string },
  ): Promise<BulkInfrastructureSummaryResponse>;
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

function buildSubdomainResults(rows: BulkHostnameRow[], domain: string) {
  return uniqueHostnames(rows).map((subdomain, index) => ({
    id: `${subdomain}-${index}`,
    subdomain,
    ...classifySubdomain(subdomain, domain),
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
  limit: number,
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
  return mapHostnamesToRecords(
    extractCnameResults(payload).slice(0, limit),
    "CNAME",
    "Live",
  );
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

    async lookupSubdomains({ domain, limit }) {
      const rows = await options.repository.lookupSubdomains({ domain, limit });

      return {
        domain,
        results: buildSubdomainResults(rows, domain),
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
  };
}
