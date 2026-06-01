import { Hono } from "hono";

import {
  isValidDomain,
  isValidIpAddress,
  normalizeDomainInput,
  normalizeIpInput,
} from "@/lib/subdomain-intelligence";
import type { CtAlertCategory, CtAlertSeverity, CtWatchType } from "@/ct/types";

import type { BulkApiConfig } from "./config";
import type { BulkApiLookupService } from "./service";
import { CtWatchlistPermissionError } from "./repository";
import type { SubdomainFilter } from "./repository";

const INVALID_DOMAIN_SUBDOMAINS_ERROR =
  "Enter at least one domain or subdomain search term to inspect subdomain infrastructure.";
const INVALID_SUBDOMAIN_SCOPE_ERROR = "Select a valid subdomain search scope.";
const INVALID_DOMAIN_SUBDOMAIN_MODIFIER_ERROR = "Select a valid domain search modifier.";
const INVALID_SUBDOMAIN_MODIFIER_ERROR = "Select a valid subdomain search modifier.";
const INVALID_SUBDOMAIN_WILDCARD_ERROR =
  "Use * as the only wildcard in domain and subdomain search terms.";
const INVALID_DOMAIN_CNAMES_ERROR = "Enter a valid domain to inspect CNAME records.";
const INVALID_DOMAIN_SUMMARY_ERROR = "Enter a valid domain to inspect infrastructure summary.";
const INVALID_DOMAIN_EXISTS_ERROR = "Enter a valid domain to check availability.";
const INVALID_IP_ERROR = "Enter a valid IP address to inspect reverse DNS records.";
const INVALID_CT_CATEGORY_ERROR = "Select a valid CT alert category.";
const INVALID_CT_SEVERITY_ERROR = "Select a valid CT alert severity.";
const INVALID_CT_WATCH_TYPE_ERROR = "Select a valid CT watchlist type.";
const INVALID_CT_DUMP_DATE_ERROR = "Enter a valid CT dump date in YYYY-MM-DD format.";
const INVALID_CT_WATCH_TERM_ERROR = "Enter a CT watchlist term to monitor.";
const INVALID_CT_WATCHLIST_ENTRY_ID_ERROR = "Enter a valid CT watchlist entry id.";
const INVALID_CT_WATCHLIST_ACTOR_ERROR = "Sign in to manage the CT watchlist.";

type CreateBulkApiAppOptions = {
  config: BulkApiConfig;
  lookupService: BulkApiLookupService;
};

type SubdomainSearchScope = "domains" | "subdomains" | "both";
type SubdomainSearchModifier = "starts_with" | "ends_with" | "contains";
type SubdomainSearchInclusion = "included" | "excluded";
// No default limit - show all results

const CT_ALERT_CATEGORIES = new Set<CtAlertCategory>([
  "phishing",
  "brand-protection",
  "shadow-it",
  "typosquatting",
]);
const CT_ALERT_SEVERITIES = new Set<CtAlertSeverity>(["high", "medium"]);
const CT_WATCH_TYPES = new Set<CtWatchType>(["brand", "internal", "keyword", "typo"]);
const SUBDOMAIN_SEARCH_SCOPES = new Set<SubdomainSearchScope>(["domains", "subdomains", "both"]);
const SUBDOMAIN_SEARCH_MODIFIERS = new Set<SubdomainSearchModifier>([
  "starts_with",
  "ends_with",
  "contains",
]);
const SUBDOMAIN_SEARCH_INCLUSIONS = new Set<SubdomainSearchInclusion>([
  "included",
  "excluded",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUMP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeLimit(
  value: string | null | undefined,
  fallback: number,
  max?: number,
): number;
function normalizeLimit(
  value: string | null | undefined,
  fallback?: undefined,
  max?: number,
): number | undefined;
function normalizeLimit(
  value: string | null | undefined,
  fallback?: number,
  max = 500,
) {
  if (!value) {
    return fallback;
  }

  if (value.toLowerCase() === "all") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(parsed), max);
}

function normalizeOffset(value: string | null | undefined, fallback = 0) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.trunc(parsed);
}

function normalizeCtCategory(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return CT_ALERT_CATEGORIES.has(value as CtAlertCategory)
    ? (value as CtAlertCategory)
    : null;
}

function normalizeCtSeverity(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return CT_ALERT_SEVERITIES.has(value as CtAlertSeverity) ? (value as CtAlertSeverity) : null;
}

function normalizeCtWatchType(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return CT_WATCH_TYPES.has(value as CtWatchType) ? (value as CtWatchType) : null;
}

function normalizeCtDumpDate(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return DUMP_DATE_PATTERN.test(value) ? value : null;
}

function normalizeSubdomainSearchScope(value: string | null | undefined) {
  if (!value) {
    return "both" as const;
  }

  return SUBDOMAIN_SEARCH_SCOPES.has(value as SubdomainSearchScope)
    ? (value as SubdomainSearchScope)
    : null;
}

function normalizeSubdomainSearchModifier(value: string | null | undefined) {
  if (!value) {
    return "contains" as const;
  }

  return SUBDOMAIN_SEARCH_MODIFIERS.has(value as SubdomainSearchModifier)
    ? (value as SubdomainSearchModifier)
    : null;
}

function normalizeSubdomainSearchTerm(value: string | null | undefined) {
  return normalizeDomainInput(value ?? "");
}

function normalizeSubdomainSearchInclusion(value: string | null | undefined): SubdomainSearchInclusion {
  if (!value) {
    return "included";
  }

  return SUBDOMAIN_SEARCH_INCLUSIONS.has(value as SubdomainSearchInclusion)
    ? (value as SubdomainSearchInclusion)
    : "included";
}

function hasEffectiveSubdomainSearchTerm(value: string) {
  return value.replaceAll("*", "").trim().length > 0;
}

function hasUnsupportedSubdomainWildcard(value: string) {
  return value.includes("%") || value.includes("_");
}

function normalizeWatchlistEntryId(value: string | undefined) {
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function normalizeEnabledFlag(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

function readDashboardActor(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function createBulkApiApp(options: CreateBulkApiAppOptions) {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "bulk-api",
      activeSnapshotMonth: options.config.activeSnapshotMonth,
    }),
  );

  app.get("/v1/reverse-ip", async (c) => {
    const ip = normalizeIpInput(c.req.query("ip") ?? "");
    const includeInactive = c.req.query("includeInactive") === "true";

    if (!isValidIpAddress(ip)) {
      return c.json({ error: INVALID_IP_ERROR }, 400);
    }

    try {
      const response = await options.lookupService.lookupReverseIp({
        ip,
        includeInactive,
        limit: normalizeLimit(c.req.query("limit"), 10),
      });

      return c.json(response);
    } catch {
      return c.json({ error: "The reverse DNS lookup request could not be completed." }, 502);
    }
  });

  app.get("/v1/subdomains", async (c) => {
    const scope = normalizeSubdomainSearchScope(c.req.query("scope"));
    const filtersRaw = c.req.query("filters");

    if (scope === null) {
      return c.json({ error: INVALID_SUBDOMAIN_SCOPE_ERROR }, 400);
    }

    function parseFilters(raw: string | undefined): SubdomainFilter[] | undefined {
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
        return parsed.map((f: Record<string, unknown>, i: number) => ({
          id: String(f.id ?? `filter-${i}`),
          term: String(f.term ?? ""),
          modifier: ["starts", "ends", "contains", "exact"].includes(String(f.modifier ?? ""))
            ? String(f.modifier) as SubdomainFilter["modifier"]
            : "contains",
          include: f.include !== false,
        }));
      } catch {
        return undefined;
      }
    }

    let filters = parseFilters(filtersRaw) ?? [];
    const domainFilters = parseFilters(c.req.query("domainFilters"));
    const subdomainFilters = parseFilters(c.req.query("subdomainFilters"));

    if (scope === "both") {
      if (!domainFilters && !subdomainFilters && filters.length === 0) {
        return c.json({ error: INVALID_DOMAIN_SUBDOMAINS_ERROR }, 400);
      }
    } else {
      if (filters.length === 0) {
        return c.json({ error: INVALID_DOMAIN_SUBDOMAINS_ERROR }, 400);
      }
    }

    const allFilters = [
      ...filters,
      ...(domainFilters ?? []),
      ...(subdomainFilters ?? []),
    ];

    if (allFilters.some((f: SubdomainFilter) => f.term.includes("%") || f.term.includes("_"))) {
      return c.json({ error: INVALID_SUBDOMAIN_WILDCARD_ERROR }, 400);
    }

    const addedSince = c.req.query("addedSince") ?? undefined;
    const parsedPage = Number.parseInt(c.req.query("page") ?? "1", 10);
    const parsedLimit = Number.parseInt(c.req.query("limit") ?? "25", 10);
    const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
    const limit = Number.isFinite(parsedLimit) ? Math.min(25, Math.max(1, parsedLimit)) : 25;
    const offset = Math.min((page - 1) * limit, 975);

    try {
      const response = await options.lookupService.lookupSubdomains({
        scope,
        filters,
        domainFilters,
        subdomainFilters,
        addedSince,
        limit,
        offset,
      });

      return c.json(response);
    } catch {
      return c.json({ error: "The subdomain lookup request could not be completed." }, 502);
    }
  });

  app.get("/v1/connected-domains", async (c) => {
    const domain = normalizeDomainInput(c.req.query("domain") ?? "");

    if (!isValidDomain(domain)) {
      return c.json({ error: "Enter a valid domain to find connected domains sharing the same IP addresses." }, 400);
    }

    try {
      const response = await options.lookupService.lookupConnectedDomains({
        domain,
        limit: normalizeLimit(c.req.query("limit"), 500, 2000),
      });

      return c.json(response);
    } catch {
      return c.json({ error: "The connected domains lookup request could not be completed." }, 502);
    }
  });

  app.get("/v1/domain-exists", async (c) => {
    const domain = normalizeDomainInput(c.req.query("domain") ?? "");

    if (!isValidDomain(domain)) {
      return c.json({ error: INVALID_DOMAIN_EXISTS_ERROR }, 400);
    }

    try {
      const response = await options.lookupService.checkDomainExists(domain);
      return c.json(response);
    } catch {
      return c.json({ error: "The domain availability check could not be completed." }, 502);
    }
  });

  app.get("/v1/cnames", async (c) => {
    const domain = normalizeDomainInput(c.req.query("domain") ?? "");

    if (!isValidDomain(domain)) {
      return c.json({ error: INVALID_DOMAIN_CNAMES_ERROR }, 400);
    }

    try {
      const response = await options.lookupService.lookupCnames({
        domain,
        limit: normalizeLimit(c.req.query("limit")),
      });

      return c.json(response);
    } catch {
      return c.json({ error: "The CNAME lookup request could not be completed." }, 502);
    }
  });

  app.get("/v1/infrastructure/summary", async (c) => {
    const domain = normalizeDomainInput(c.req.query("domain") ?? "");

    if (!isValidDomain(domain)) {
      return c.json({ error: INVALID_DOMAIN_SUMMARY_ERROR }, 400);
    }

    try {
      const response = await options.lookupService.lookupInfrastructureSummary({ domain });

      return c.json(response);
    } catch {
      return c.json(
        { error: "The infrastructure summary lookup request could not be completed." },
        502,
      );
    }
  });

  app.get("/v1/ct/alerts/export", async (c) => {
    const category = normalizeCtCategory(c.req.query("category"));
    const severity = normalizeCtSeverity(c.req.query("severity"));
    const watchType = normalizeCtWatchType(c.req.query("watchType"));
    const dumpDate = normalizeCtDumpDate(c.req.query("dumpDate"));

    if (category === null) {
      return c.json({ error: INVALID_CT_CATEGORY_ERROR }, 400);
    }

    if (severity === null) {
      return c.json({ error: INVALID_CT_SEVERITY_ERROR }, 400);
    }

    if (watchType === null) {
      return c.json({ error: INVALID_CT_WATCH_TYPE_ERROR }, 400);
    }

    if (dumpDate === null) {
      return c.json({ error: INVALID_CT_DUMP_DATE_ERROR }, 400);
    }

    try {
      const results = await options.lookupService.exportCtAlerts({
        limit: normalizeLimit(c.req.query("limit"), 500, 5000),
        ...(category ? { category } : {}),
        ...(severity ? { severity } : {}),
        ...(watchType ? { watchType } : {}),
        ...(dumpDate ? { dumpDate } : {}),
      });

      const headerRow = "id,observedAt,domain,category,severity,watchType,matchedTerm,reasons,issuerName";
      const csvRows = results.map((r) =>
        [
          r.id,
          r.observedAt,
          r.domain,
          r.category,
          r.severity,
          r.watchType,
          r.matchedTerm,
          r.reasons.join("; "),
          r.issuerName ?? "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );

      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header(
        "Content-Disposition",
        `attachment; filename="ct-alerts-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      );

      return c.body([headerRow, ...csvRows].join("\n"));
    } catch {
      return c.json({ error: "The CT alert export request could not be completed." }, 502);
    }
  });

  app.get("/v1/ct/alerts", async (c) => {
    const category = normalizeCtCategory(c.req.query("category"));
    const severity = normalizeCtSeverity(c.req.query("severity"));
    const watchType = normalizeCtWatchType(c.req.query("watchType"));
    const dumpDate = normalizeCtDumpDate(c.req.query("dumpDate"));

    if (category === null) {
      return c.json({ error: INVALID_CT_CATEGORY_ERROR }, 400);
    }

    if (severity === null) {
      return c.json({ error: INVALID_CT_SEVERITY_ERROR }, 400);
    }

    if (watchType === null) {
      return c.json({ error: INVALID_CT_WATCH_TYPE_ERROR }, 400);
    }

    if (dumpDate === null) {
      return c.json({ error: INVALID_CT_DUMP_DATE_ERROR }, 400);
    }

    try {
      const response = await options.lookupService.lookupCtAlerts({
        limit: normalizeLimit(c.req.query("limit"), 50, 500),
        offset: normalizeOffset(c.req.query("offset")),
        ...(category ? { category } : {}),
        ...(severity ? { severity } : {}),
        ...(watchType ? { watchType } : {}),
        ...(dumpDate ? { dumpDate } : {}),
      });

      return c.json(response);
    } catch {
      return c.json({ error: "The CT alert lookup request could not be completed." }, 502);
    }
  });

  app.get("/v1/ct/alerts/summary", async (c) => {
    const category = normalizeCtCategory(c.req.query("category"));
    const severity = normalizeCtSeverity(c.req.query("severity"));
    const watchType = normalizeCtWatchType(c.req.query("watchType"));

    if (category === null) {
      return c.json({ error: INVALID_CT_CATEGORY_ERROR }, 400);
    }

    if (severity === null) {
      return c.json({ error: INVALID_CT_SEVERITY_ERROR }, 400);
    }

    if (watchType === null) {
      return c.json({ error: INVALID_CT_WATCH_TYPE_ERROR }, 400);
    }

    try {
      return c.json(await options.lookupService.lookupCtAlertSummary({
        ...(category ? { category } : {}),
        ...(severity ? { severity } : {}),
        ...(watchType ? { watchType } : {}),
      }));
    } catch {
      return c.json({ error: "The CT alert summary request could not be completed." }, 502);
    }
  });

  app.get("/v1/ct-ingestion-summary", async (c) => {
    try {
      const response = await options.lookupService.lookupCtIngestionSummary();
      return c.json({ success: true, data: response.results });
    } catch {
      return c.json({ error: "The CT ingestion summary request could not be completed." }, 502);
    }
  });

  app.get("/v1/ct/watchlists", async (c) => {
    const actor = readDashboardActor(c.req.header("x-dashboard-user"));

    if (!actor) {
      return c.json({ error: INVALID_CT_WATCHLIST_ACTOR_ERROR }, 401);
    }

    try {
      return c.json(await options.lookupService.listCtWatchlistEntries(actor));
    } catch {
      return c.json({ error: "The CT watchlist request could not be completed." }, 502);
    }
  });

  app.post("/v1/ct/watchlists", async (c) => {
    const actor = readDashboardActor(c.req.header("x-dashboard-user"));
    const body = await c.req.json().catch(() => null);
    const watchType = normalizeCtWatchType(body?.watchType);
    const term = typeof body?.term === "string" ? body.term.trim() : "";
    const enabled =
      typeof body?.enabled === "undefined" ? true : normalizeEnabledFlag(body.enabled);

    if (!actor) {
      return c.json({ error: INVALID_CT_WATCHLIST_ACTOR_ERROR }, 401);
    }

    if (watchType !== "brand" && watchType !== "internal" && watchType !== "keyword" && watchType !== "typo") {
      return c.json({ error: INVALID_CT_WATCH_TYPE_ERROR }, 400);
    }

    if (!term) {
      return c.json({ error: INVALID_CT_WATCH_TERM_ERROR }, 400);
    }

    if (enabled === null) {
      return c.json({ error: "CT watchlist enabled must be true or false." }, 400);
    }

    const typos = body.typos === true;

    try {
      const response = await options.lookupService.createCtWatchlistEntry({
        watchType,
        term,
        enabled,
        typos,
        actor,
      });

      return c.json(response, 201);
    } catch (error) {
      if (error instanceof CtWatchlistPermissionError) {
        return c.json({ error: error.message }, 403);
      }
      return c.json({ error: "The CT watchlist entry could not be created." }, 502);
    }
  });

  app.patch("/v1/ct/watchlists/:entryId", async (c) => {
    const actor = readDashboardActor(c.req.header("x-dashboard-user"));
    const entryId = normalizeWatchlistEntryId(c.req.param("entryId"));
    const body = await c.req.json().catch(() => null);
    const watchType = normalizeCtWatchType(body?.watchType);
    const enabled =
      typeof body?.enabled === "undefined" ? undefined : normalizeEnabledFlag(body.enabled);
    const term = typeof body?.term === "string" ? body.term.trim() : undefined;

    if (!actor) {
      return c.json({ error: INVALID_CT_WATCHLIST_ACTOR_ERROR }, 401);
    }

    if (!entryId) {
      return c.json({ error: INVALID_CT_WATCHLIST_ENTRY_ID_ERROR }, 400);
    }

    if (body?.watchType && watchType === null) {
      return c.json({ error: INVALID_CT_WATCH_TYPE_ERROR }, 400);
    }

    if (body?.term !== undefined && !term) {
      return c.json({ error: INVALID_CT_WATCH_TERM_ERROR }, 400);
    }

    if (enabled === null) {
      return c.json({ error: "CT watchlist enabled must be true or false." }, 400);
    }

    if (
      typeof watchType === "undefined" &&
      typeof term === "undefined" &&
      typeof enabled === "undefined"
    ) {
      return c.json({ error: "Provide at least one CT watchlist field to update." }, 400);
    }

    try {
      const response = await options.lookupService.updateCtWatchlistEntry({
        entryId,
        ...(watchType ? { watchType } : {}),
        ...(typeof term === "string" ? { term } : {}),
        ...(typeof enabled === "boolean" ? { enabled } : {}),
        ...(typeof body.typos === "boolean" ? { typos: body.typos } : {}),
        actor,
      });

      if (!response) {
        return c.json({ error: "The CT watchlist entry was not found." }, 404);
      }

      return c.json(response);
    } catch (error) {
      if (error instanceof CtWatchlistPermissionError) {
        return c.json({ error: error.message }, 403);
      }

      return c.json({ error: "The CT watchlist entry could not be updated." }, 502);
    }
  });

  app.delete("/v1/ct/watchlists/:entryId", async (c) => {
    const actor = readDashboardActor(c.req.header("x-dashboard-user"));
    const entryId = normalizeWatchlistEntryId(c.req.param("entryId"));

    if (!actor) {
      return c.json({ error: INVALID_CT_WATCHLIST_ACTOR_ERROR }, 401);
    }

    if (!entryId) {
      return c.json({ error: INVALID_CT_WATCHLIST_ENTRY_ID_ERROR }, 400);
    }

    try {
      const deleted = await options.lookupService.deleteCtWatchlistEntry(entryId, actor);

      if (!deleted) {
        return c.json({ error: "The CT watchlist entry was not found." }, 404);
      }

      return c.json({ ok: true, entryId });
    } catch (error) {
      if (error instanceof CtWatchlistPermissionError) {
        return c.json({ error: error.message }, 403);
      }

      return c.json({ error: "The CT watchlist entry could not be deleted." }, 502);
    }
  });

  return app;
}
