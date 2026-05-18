"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BellDot,
  ChevronLeft,
  ChevronRight,
  RefreshCcw,
  Search,
  ShieldAlert,
  Radar,
  Trash2,
} from "lucide-react";

import type {
  CtAlertCategory,
  CtAlertSeverity,
  CtWatchType,
  CtWatchlistEntry,
} from "@/ct/types";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { LookupWorkspaceSidebar, type TabId } from "@/components/ui/sidebar-component";
import {
  isValidDomain,
  isValidIpAddress,
  normalizeDomainInput,
  normalizeIpInput,
  type SubdomainRecord,
  type SubdomainStatus,
} from "@/lib/subdomain-intelligence";
import { normalizeTechStackTarget } from "@/lib/tech-stack/normalize";
import type { TechConfidence, TechDetectionResult } from "@/lib/tech-stack/types";
import { cn } from "@/lib/utils";

const RESULTS_PER_PAGE = 20;

type LookupResult = SubdomainRecord | TechDetectionResult;

type SearchRequest = {
  target: string;
  requestUrl: string;
  token: number;
};

type SubdomainSearchScope = "domains" | "subdomains" | "both";
type SubdomainSearchModifier = "starts_with" | "ends_with" | "contains";

type SubdomainSearchFormState = {
  scope: SubdomainSearchScope;
  domainTerm: string;
  domainModifier: SubdomainSearchModifier;
  subdomainTerm: string;
  subdomainModifier: SubdomainSearchModifier;
};

type SubdomainValidationState = {
  domain: boolean;
  subdomain: boolean;
};

type LookupApiResponse = {
  domain?: string;
  target?: string;
  results: LookupResult[];
  error?: string;
};

type CtAlertRecord = {
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

type CtAlertSummaryResponse = {
  newestDumpDate: string | null;
  totals: {
    alerts: number;
    phishing: number;
    brandProtection: number;
    shadowIt: number;
    highSeverity: number;
  };
  error?: string;
};

type CtAlertFeedResponse = {
  results: CtAlertRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
  error?: string;
};

type CtWatchlistResponse = {
  entries: CtWatchlistEntry[];
  error?: string;
};

type CtWatchlistMutationResponse = {
  entry: CtWatchlistEntry;
  error?: string;
};

type CtFilterCategory = CtAlertCategory | "all";
type CtFilterSeverity = CtAlertSeverity | "all";
type CtFilterWatchType = CtWatchType | "all";

type CtFilterState = {
  category: CtFilterCategory;
  severity: CtFilterSeverity;
  watchType: CtFilterWatchType;
};

type TabConfig = {
  label: string;
  inputAriaLabel: string;
  searchPlaceholder: string;
  endpoint: string;
  queryParam: "domain" | "ip" | "target";
  resultsHeading: string;
  resultColumnTitle: string;
  noResultsTitle: string;
  noResultsHint: string;
  loadingLabel: string;
  emptyPrompt: string;
  resultMode: "dns" | "tech";
  normalizeQuery: (query: string) => string | null;
  buildValidationMessage: () => string;
};

const INVALID_SUBDOMAIN_WILDCARD_ERROR =
  "Use * as the only wildcard in domain and subdomain search terms.";
const INVALID_SUBDOMAIN_ASTERISK_ERROR =
  "Use * only as a standalone wildcard in domain and subdomain search terms.";
const EMPTY_SUBDOMAIN_SEARCH_ERROR =
  "Enter at least one domain or subdomain search term to inspect subdomain infrastructure.";
const EMPTY_DOMAIN_SCOPE_SEARCH_ERROR =
  "Enter at least one domain search term to inspect subdomain infrastructure.";
const EMPTY_SUBDOMAIN_SCOPE_SEARCH_ERROR =
  "Enter at least one subdomain search term to inspect subdomain infrastructure.";

const SUBDOMAIN_SCOPE_OPTIONS: Array<{ value: SubdomainSearchScope; label: string }> = [
  { value: "domains", label: "Domains only" },
  { value: "subdomains", label: "Subdomains only" },
  { value: "both", label: "Both" },
];

const SUBDOMAIN_MODIFIER_OPTIONS: Array<{
  value: SubdomainSearchModifier;
  label: string;
}> = [
  { value: "starts_with", label: "Starts with" },
  { value: "ends_with", label: "Ends with" },
  { value: "contains", label: "Contains" },
];

const TAB_COPY: Record<TabId, TabConfig> = {
  subdomain: {
    label: "Domain & Subdomain Discovery",
    inputAriaLabel: "Search or inspect a domain",
    searchPlaceholder: "Enter a domain, e.g. stripe.com",
    endpoint: "/api/subdomains",
    queryParam: "domain",
    resultsHeading: "Subdomain Results",
    resultColumnTitle: "Subdomain",
    noResultsTitle: "No results",
    noResultsHint:
      "Adjust the scope or modifiers, or confirm that the upstream subdomain dataset has indexed matching records.",
    loadingLabel: "subdomains",
    emptyPrompt: "Enter one or more search terms above to start",
    resultMode: "dns",
    normalizeQuery: (query) => {
      const normalized = normalizeDomainInput(query);
      return normalized && isValidDomain(normalized) ? normalized : null;
    },
    buildValidationMessage: () => "Enter a valid apex domain.",
  },
  cname: {
    label: "CNAME Lookup",
    inputAriaLabel: "Search or inspect a domain",
    searchPlaceholder: "Enter a domain, e.g. status.openai.com",
    endpoint: "/api/cnames",
    queryParam: "domain",
    resultsHeading: "CNAME Results",
    resultColumnTitle: "CNAME / Host",
    noResultsTitle: "No results",
    noResultsHint:
      "Try another domain, or confirm that the upstream CNAME dataset has indexed it.",
    loadingLabel: "CNAMEs",
    emptyPrompt: "Enter a domain above to start",
    resultMode: "dns",
    normalizeQuery: (query) => {
      const normalized = normalizeDomainInput(query);
      return normalized && isValidDomain(normalized) ? normalized : null;
    },
    buildValidationMessage: () => "Enter a valid domain.",
  },
  "reverse-dns": {
    label: "Reverse DNS Lookup",
    inputAriaLabel: "Search or inspect an IP address",
    searchPlaceholder: "Enter an IP address, e.g. 142.251.43.46",
    endpoint: "/api/reverse-dns",
    queryParam: "ip",
    resultsHeading: "Reverse DNS Results",
    resultColumnTitle: "Hostname",
    noResultsTitle: "No results",
    noResultsHint:
      "Try another IP address, or confirm that the upstream dataset has indexed it.",
    loadingLabel: "hostnames",
    emptyPrompt: "Enter an IP address above to start",
    resultMode: "dns",
    normalizeQuery: (query) => {
      const normalized = normalizeIpInput(query);
      return normalized && isValidIpAddress(normalized) ? normalized : null;
    },
    buildValidationMessage: () => "Enter a valid IP address.",
  },
  "tech-stack": {
    label: "Tech Stack",
    inputAriaLabel: "Search or inspect a website",
    searchPlaceholder: "Enter a website URL or domain, e.g. stripe.com",
    endpoint: "/api/tech-stack",
    queryParam: "target",
    resultsHeading: "Tech Stack Results",
    resultColumnTitle: "Technology",
    noResultsTitle: "No technologies detected",
    noResultsHint:
      "We couldn't confidently identify supported technologies from the current website signals.",
    loadingLabel: "website signals",
    emptyPrompt: "Enter a website URL or domain above to start",
    resultMode: "tech",
    normalizeQuery: (query) => normalizeTechStackTarget(query)?.displayTarget ?? null,
    buildValidationMessage: () =>
      "Enter a valid domain or URL to inspect the website tech stack.",
  },
  "ct-monitor": {
    label: "CT Monitor",
    inputAriaLabel: "CT Monitor",
    searchPlaceholder: "",
    endpoint: "/api/alerts",
    queryParam: "domain",
    resultsHeading: "CT Alert Feed",
    resultColumnTitle: "Domain",
    noResultsTitle: "No alerts",
    noResultsHint: "New CT alerts will appear here after the next batch load.",
    loadingLabel: "CT alerts",
    emptyPrompt: "CT Monitor loads the latest alert feed automatically",
    resultMode: "dns",
    normalizeQuery: () => null,
    buildValidationMessage: () => "",
  },
};

const CT_CATEGORY_OPTIONS: Array<{ value: CtFilterCategory; label: string }> = [
  { value: "all", label: "All categories" },
  { value: "phishing", label: "Phishing" },
  { value: "brand-protection", label: "Brand protection" },
  { value: "shadow-it", label: "Shadow IT" },
];

const CT_SEVERITY_OPTIONS: Array<{ value: CtFilterSeverity; label: string }> = [
  { value: "all", label: "All severities" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
];

const CT_WATCH_TYPE_OPTIONS: Array<{ value: CtFilterWatchType; label: string }> = [
  { value: "all", label: "All watchlists" },
  { value: "brand", label: "Brand" },
  { value: "internal", label: "Internal" },
  { value: "keyword", label: "Keyword" },
];

export function DashboardShell() {
  const [query, setQuery] = useState("");
  const [subdomainForm, setSubdomainForm] = useState<SubdomainSearchFormState>({
    scope: "both",
    domainTerm: "",
    domainModifier: "contains",
    subdomainTerm: "",
    subdomainModifier: "contains",
  });
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const [results, setResults] = useState<LookupResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [subdomainValidationState, setSubdomainValidationState] = useState<SubdomainValidationState>({
    domain: false,
    subdomain: false,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [announcement, setAnnouncement] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("subdomain");
  const [ctSummary, setCtSummary] = useState<CtAlertSummaryResponse | null>(null);
  const [ctAlerts, setCtAlerts] = useState<CtAlertRecord[]>([]);
  const [ctAlertTotal, setCtAlertTotal] = useState(0);
  const [ctCurrentPage, setCtCurrentPage] = useState(1);
  const [ctWatchlists, setCtWatchlists] = useState<CtWatchlistEntry[]>([]);
  const [ctFilters, setCtFilters] = useState<CtFilterState>({
    category: "all",
    severity: "all",
    watchType: "all",
  });
  const [ctIsLoading, setCtIsLoading] = useState(false);
  const [ctError, setCtError] = useState<string | null>(null);
  const [ctWatchlistError, setCtWatchlistError] = useState<string | null>(null);
  const [ctWatchTerm, setCtWatchTerm] = useState("");
  const [ctWatchType, setCtWatchType] = useState<CtWatchType>("brand");
  const [ctWatchEnabled, setCtWatchEnabled] = useState(true);
  const [ctMutationKey, setCtMutationKey] = useState<string | null>(null);
  const [ctRefreshToken, setCtRefreshToken] = useState(0);

  const tab = TAB_COPY[activeTab];
  const isMonitorTab = activeTab === "ct-monitor";
  const isSubdomainTab = activeTab === "subdomain";

  useEffect(() => {
    if (!searchRequest || isMonitorTab) {
      return;
    }

    const target = searchRequest.target;
    const requestUrl = searchRequest.requestUrl;
    const abortController = new AbortController();
    let isCancelled = false;

    async function fetchResults() {
      setIsLoading(true);
      setLookupError(null);
      setValidationError(null);
      setAnnouncement(`Searching for ${tab.loadingLabel} for ${target}...`);

      try {
        const response = await fetch(requestUrl, {
          signal: abortController.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as LookupApiResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "The lookup could not be completed.");
        }

        if (isCancelled) {
          return;
        }

        setResults(payload.results);
        setCurrentPage(1);
        setAnnouncement(
          payload.results.length > 0
            ? `Found ${payload.results.length} ${tab.loadingLabel} for ${target}.`
            : `No ${tab.loadingLabel} found for ${target}.`,
        );
      } catch (caughtError) {
        if (abortController.signal.aborted || isCancelled) {
          return;
        }

        setResults([]);
        setCurrentPage(1);
        const errorMessage =
          caughtError instanceof Error
            ? caughtError.message
            : "The lookup could not be completed.";
        setLookupError(errorMessage);
        setSubdomainValidationState({
          domain: false,
          subdomain: false,
        });
        setAnnouncement(`Error: ${errorMessage}`);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchResults();

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [isMonitorTab, searchRequest, tab.loadingLabel]);

  useEffect(() => {
    if (!isMonitorTab) {
      return;
    }

    const abortController = new AbortController();
    let isCancelled = false;

    async function fetchCtMonitorData() {
      setCtIsLoading(true);
      setCtError(null);
      setCtWatchlistError(null);
      setAnnouncement("Refreshing Certificate Transparency alerts...");

      try {
        const alertParams = new URLSearchParams({
          limit: String(RESULTS_PER_PAGE),
          offset: String((ctCurrentPage - 1) * RESULTS_PER_PAGE),
        });

        if (ctFilters.category !== "all") {
          alertParams.set("category", ctFilters.category);
        }

        if (ctFilters.severity !== "all") {
          alertParams.set("severity", ctFilters.severity);
        }

        if (ctFilters.watchType !== "all") {
          alertParams.set("watchType", ctFilters.watchType);
        }

        const [summaryResult, alertsResult, watchlistResult] = await Promise.allSettled([
          fetch("/api/alerts/summary", {
            signal: abortController.signal,
            cache: "no-store",
          }),
          fetch(`/api/alerts?${alertParams.toString()}`, {
            signal: abortController.signal,
            cache: "no-store",
          }),
          fetch("/api/watchlists", {
            signal: abortController.signal,
            cache: "no-store",
          }),
        ]);

        if (summaryResult.status === "rejected") {
          throw summaryResult.reason;
        }

        if (alertsResult.status === "rejected") {
          throw alertsResult.reason;
        }

        const [summaryPayload, alertsPayload] = (await Promise.all([
          summaryResult.value.json(),
          alertsResult.value.json(),
        ])) as [CtAlertSummaryResponse, CtAlertFeedResponse];

        if (!summaryResult.value.ok) {
          throw new Error(summaryPayload.error ?? "The CT alert summary could not be loaded.");
        }

        if (!alertsResult.value.ok) {
          throw new Error(alertsPayload.error ?? "The CT alert feed could not be loaded.");
        }

        if (isCancelled) {
          return;
        }

        setCtSummary(summaryPayload);
        setCtAlerts(alertsPayload.results);
        setCtAlertTotal(alertsPayload.pagination.total);

        if (watchlistResult.status === "fulfilled") {
          const watchlistPayload = (await watchlistResult.value.json()) as CtWatchlistResponse;

          if (watchlistResult.value.ok) {
            setCtWatchlists(watchlistPayload.entries);
            setCtWatchlistError(null);
          } else {
            setCtWatchlistError(
              watchlistPayload.error ?? "The CT watchlist could not be loaded.",
            );
          }
        } else {
          setCtWatchlistError("The CT watchlist could not be loaded.");
        }

        setAnnouncement(
          alertsPayload.results.length > 0
            ? `Loaded ${alertsPayload.pagination.total} CT alerts.`
            : "No CT alerts matched the current filters.",
        );
      } catch (caughtError) {
        if (abortController.signal.aborted || isCancelled) {
          return;
        }

        const errorMessage =
          caughtError instanceof Error
            ? caughtError.message
            : "The CT monitor could not be loaded.";
        setCtError(errorMessage);
        setCtSummary(null);
        setCtAlerts([]);
        setCtAlertTotal(0);
        setAnnouncement(`Error: ${errorMessage}`);
      } finally {
        if (!isCancelled) {
          setCtIsLoading(false);
        }
      }
    }

    void fetchCtMonitorData();

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [
    ctCurrentPage,
    ctFilters.category,
    ctFilters.severity,
    ctFilters.watchType,
    ctRefreshToken,
    isMonitorTab,
  ]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(results.length / RESULTS_PER_PAGE)),
    [results.length],
  );

  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * RESULTS_PER_PAGE;
    return results.slice(start, start + RESULTS_PER_PAGE);
  }, [currentPage, results]);

  const ctTotalPages = useMemo(
    () => Math.max(1, Math.ceil(ctAlertTotal / RESULTS_PER_PAGE)),
    [ctAlertTotal],
  );

  const hasSearched = searchRequest !== null;
  const activeTarget = searchRequest?.target ?? "";
  const showingResults = hasSearched || isLoading || lookupError !== null;
  const errorMessage = validationError ?? lookupError;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubdomainTab) {
      const domainTerm = normalizeDomainInput(subdomainForm.domainTerm);
      const subdomainTerm = normalizeDomainInput(subdomainForm.subdomainTerm);
      const invalidWildcardState = {
        domain: hasUnsupportedSubdomainWildcard(domainTerm) || hasInvalidSubdomainAsterisk(domainTerm),
        subdomain:
          hasUnsupportedSubdomainWildcard(subdomainTerm) || hasInvalidSubdomainAsterisk(subdomainTerm),
      };

      if (invalidWildcardState.domain || invalidWildcardState.subdomain) {
        setSearchRequest(null);
        setResults([]);
        setCurrentPage(1);
        setSubdomainValidationState(invalidWildcardState);
        setValidationError(
          invalidWildcardState.domain && invalidWildcardState.subdomain
            ? INVALID_SUBDOMAIN_ASTERISK_ERROR
            : hasUnsupportedSubdomainWildcard(domainTerm) || hasUnsupportedSubdomainWildcard(subdomainTerm)
              ? INVALID_SUBDOMAIN_WILDCARD_ERROR
              : INVALID_SUBDOMAIN_ASTERISK_ERROR,
        );
        setLookupError(null);
        setAnnouncement(
          `Error: ${
            invalidWildcardState.domain && invalidWildcardState.subdomain
              ? INVALID_SUBDOMAIN_ASTERISK_ERROR
              : hasUnsupportedSubdomainWildcard(domainTerm) || hasUnsupportedSubdomainWildcard(subdomainTerm)
                ? INVALID_SUBDOMAIN_WILDCARD_ERROR
                : INVALID_SUBDOMAIN_ASTERISK_ERROR
          }`,
        );
        return;
      }

      const scopeValidationMessage = getSubdomainScopeValidationMessage(
        subdomainForm.scope,
        domainTerm,
        subdomainTerm,
      );

      if (scopeValidationMessage) {
        setSearchRequest(null);
        setResults([]);
        setCurrentPage(1);
        setSubdomainValidationState(getSubdomainValidationState(subdomainForm.scope, domainTerm, subdomainTerm));
        setValidationError(scopeValidationMessage);
        setLookupError(null);
        setAnnouncement(`Error: ${scopeValidationMessage}`);
        return;
      }

      const nextFormState = {
        ...subdomainForm,
        domainTerm,
        subdomainTerm,
      };
      const searchParams = new URLSearchParams({
        scope: nextFormState.scope,
        domainTerm: nextFormState.domainTerm,
        domainModifier: nextFormState.domainModifier,
        subdomainTerm: nextFormState.subdomainTerm,
        subdomainModifier: nextFormState.subdomainModifier,
      });

      setSubdomainForm(nextFormState);
      setSubdomainValidationState({
        domain: false,
        subdomain: false,
      });
      setValidationError(null);
      setSearchRequest({
        target: buildSubdomainSearchSummary(nextFormState),
        requestUrl: `${tab.endpoint}?${searchParams.toString()}`,
        token: Date.now(),
      });
      return;
    }

    const normalizedTarget = tab.normalizeQuery(query);
    if (!normalizedTarget) {
      const message = tab.buildValidationMessage();
      setSearchRequest(null);
      setResults([]);
      setCurrentPage(1);
      setSubdomainValidationState({
        domain: false,
        subdomain: false,
      });
      setValidationError(message);
      setLookupError(null);
      setAnnouncement(`Error: ${message}`);
      return;
    }

    setQuery(normalizedTarget);
    setSubdomainValidationState({
      domain: false,
      subdomain: false,
    });
    setValidationError(null);
    setSearchRequest({
      target: normalizedTarget,
      requestUrl: `${tab.endpoint}?${tab.queryParam}=${encodeURIComponent(normalizedTarget)}`,
      token: Date.now(),
    });
  }

  function switchTab(nextTab: TabId) {
    if (nextTab === activeTab) {
      return;
    }

    setActiveTab(nextTab);
    setQuery("");
    setSubdomainForm({
      scope: "both",
      domainTerm: "",
      domainModifier: "contains",
      subdomainTerm: "",
      subdomainModifier: "contains",
    });
    setSubdomainValidationState({
      domain: false,
      subdomain: false,
    });
    setSearchRequest(null);
    setResults([]);
    setLookupError(null);
    setValidationError(null);
    setCurrentPage(1);

    if (nextTab === "ct-monitor") {
      setCtCurrentPage(1);
      setCtFilters({
        category: "all",
        severity: "all",
        watchType: "all",
      });
      setCtError(null);
    }
  }

  function updateCtFilter<K extends keyof CtFilterState>(key: K, value: CtFilterState[K]) {
    setCtFilters((current) => ({
      ...current,
      [key]: value,
    }));
    setCtCurrentPage(1);
  }

  async function handleCreateCtWatchlist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedTerm = ctWatchTerm.trim();
    if (!normalizedTerm) {
      setCtWatchlistError("Enter a watch term before adding it to CT Monitor.");
      return;
    }

    setCtMutationKey("create");
    setCtWatchlistError(null);

    try {
      const response = await fetch("/api/watchlists", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          watchType: ctWatchType,
          term: normalizedTerm,
          enabled: ctWatchEnabled,
        }),
      });
      const payload = (await response.json()) as CtWatchlistMutationResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "The CT watchlist entry could not be created.");
      }

      setCtWatchTerm("");
      setAnnouncement(`Added ${payload.entry.term} to the CT watchlist.`);
      setCtRefreshToken((value) => value + 1);
    } catch (caughtError) {
      setCtWatchlistError(
        caughtError instanceof Error
          ? caughtError.message
          : "The CT watchlist entry could not be created.",
      );
    } finally {
      setCtMutationKey(null);
    }
  }

  async function handleToggleCtWatchlist(entry: CtWatchlistEntry) {
    setCtMutationKey(entry.entryId);
    setCtWatchlistError(null);

    try {
      const response = await fetch(`/api/watchlists/${entry.entryId}`, {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: !entry.enabled,
        }),
      });
      const payload = (await response.json()) as CtWatchlistMutationResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "The CT watchlist entry could not be updated.");
      }

      setAnnouncement(
        `${payload.entry.term} is now ${payload.entry.enabled ? "enabled" : "disabled"} for CT monitoring.`,
      );
      setCtRefreshToken((value) => value + 1);
    } catch (caughtError) {
      setCtWatchlistError(
        caughtError instanceof Error
          ? caughtError.message
          : "The CT watchlist entry could not be updated.",
      );
    } finally {
      setCtMutationKey(null);
    }
  }

  async function handleDeleteCtWatchlist(entryId: string) {
    setCtMutationKey(entryId);
    setCtWatchlistError(null);

    try {
      const response = await fetch(`/api/watchlists/${entryId}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const payload = (await response.json()) as { error?: string; entryId?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "The CT watchlist entry could not be deleted.");
      }

      setAnnouncement("Removed the CT watchlist entry.");
      setCtRefreshToken((value) => value + 1);
    } catch (caughtError) {
      setCtWatchlistError(
        caughtError instanceof Error
          ? caughtError.message
          : "The CT watchlist entry could not be deleted.",
      );
    } finally {
      setCtMutationKey(null);
    }
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground" data-testid="dashboard-shell">
      <LookupWorkspaceSidebar
        className="sticky top-0 hidden h-screen lg:flex"
        activeTab={activeTab}
        onTabChange={switchTab}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white/20"
        >
          Skip to main content
        </a>
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>

        <header className="sticky top-0 z-30 flex flex-col justify-center border-b border-white/[0.08] bg-black/60 px-4 backdrop-blur-xl sm:px-5 lg:h-14 lg:flex-row lg:items-center lg:justify-start lg:px-6">
          <div className="flex h-14 shrink-0 items-center justify-between lg:hidden">
            <div className="flex items-center gap-2.5">
              <div className="flex size-6 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.05] text-white shadow-sm">
                <Radar className="size-3.5" aria-hidden="true" />
              </div>
              <span className="text-[14px] font-medium tracking-tight text-white">Automote</span>
            </div>
          </div>

          <h1 className="hidden text-[14px] font-medium text-neutral-200 lg:block">{tab.label}</h1>

          <nav className="flex overflow-x-auto no-scrollbar lg:hidden" aria-label="Tabs">
            <div className="flex w-full min-w-min gap-6 border-t border-white/[0.08]">
              {(Object.entries(TAB_COPY) as [TabId, TabConfig][]).map(([id, config]) => (
                <button
                  key={id}
                  onClick={() => switchTab(id)}
                  className={cn(
                    "whitespace-nowrap border-b-2 py-3 text-[13px] font-medium transition-colors",
                    activeTab === id
                      ? "border-white text-white"
                      : "border-transparent text-neutral-500 hover:border-neutral-700 hover:text-neutral-300",
                  )}
                >
                  {config.label}
                </button>
              ))}
            </div>
          </nav>
        </header>

        <main id="main-content" className="flex-1 min-w-0 p-4 sm:p-5 lg:p-8">
          <div className={cn("mx-auto", isMonitorTab ? "max-w-6xl" : "max-w-5xl")}>
            {isMonitorTab ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-3xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-200">
                      <BellDot className="size-3.5" aria-hidden="true" />
                      Daily CT Monitoring
                    </div>
                    <h2 className="mt-4 text-[clamp(1.75rem,3vw,2.4rem)] font-bold tracking-tight text-white">
                      Certificate Transparency Alert Feed
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                      Review newly observed certificates for phishing, brand abuse, and shadow-IT
                      exposure without touching the existing recon workflow.
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCtRefreshToken((value) => value + 1)}
                    disabled={ctIsLoading}
                    className="h-10 gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-white hover:bg-white/[0.08]"
                  >
                    <RefreshCcw className={cn("size-4", ctIsLoading ? "animate-spin" : "")} />
                    Refresh feed
                  </Button>
                </div>

                <CtSummaryCards summary={ctSummary} isLoading={ctIsLoading} />

                {ctError ? (
                  <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3">
                    <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                    <p className="text-sm text-destructive">{ctError}</p>
                  </div>
                ) : null}

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
                  <section className="rounded-xl border border-white/[0.08] bg-black shadow-2xl shadow-black/50">
                    <div className="flex flex-col gap-4 border-b border-white/[0.08] bg-[#0a0a0a] px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-white">Dense Alert Feed</h3>
                        <p className="mt-1 text-xs text-neutral-500">
                          {ctSummary?.newestDumpDate
                            ? `Latest dump: ${ctSummary.newestDumpDate}`
                            : "Waiting for the first CT batch."}
                        </p>
                      </div>
                      <CtFilterBar filters={ctFilters} onChange={updateCtFilter} />
                    </div>

                    {ctIsLoading ? (
                      <ResultsTableSkeleton variant="dns" />
                    ) : ctAlerts.length > 0 ? (
                      <>
                        <CtAlertResultsTable results={ctAlerts} />
                        {ctTotalPages > 1 ? (
                          <div className="bg-[#0a0a0a]">
                            <Pagination
                              currentPage={ctCurrentPage}
                              totalPages={ctTotalPages}
                              onPageChange={setCtCurrentPage}
                            />
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <EmptyState
                        icon={<ShieldAlert className="size-5" />}
                        title="No CT alerts matched"
                        description="Adjust the filters or wait for the next daily CT import to materialize new alert candidates."
                        tone="neutral"
                      />
                    )}
                  </section>

                  <CtWatchlistPanel
                    entries={ctWatchlists}
                    error={ctWatchlistError}
                    isLoading={ctIsLoading}
                    mutationKey={ctMutationKey}
                    watchTerm={ctWatchTerm}
                    watchType={ctWatchType}
                    watchEnabled={ctWatchEnabled}
                    onWatchTermChange={setCtWatchTerm}
                    onWatchTypeChange={setCtWatchType}
                    onWatchEnabledChange={setCtWatchEnabled}
                    onSubmit={handleCreateCtWatchlist}
                    onToggle={handleToggleCtWatchlist}
                    onDelete={handleDeleteCtWatchlist}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="mb-8 max-w-2xl">
                  <h2 className="text-[clamp(1.5rem,3vw,2rem)] font-bold tracking-tight text-white">
                    {tab.label}
                  </h2>

                  <form
                    role="search"
                    aria-label={tab.label}
                    onSubmit={handleSubmit}
                    className={cn(
                      "mt-6",
                      isSubdomainTab
                        ? "max-w-3xl rounded-xl border border-white/[0.08] bg-[#080808] p-5 shadow-2xl shadow-black/40"
                        : "flex max-w-xl flex-col gap-3 sm:flex-row sm:items-center",
                    )}
                  >
                    {isSubdomainTab ? (
                      <div className="space-y-4">
                        <fieldset className="space-y-2">
                          <legend className="text-[12px] font-medium uppercase tracking-[0.08em] text-neutral-400">
                            Search Scope
                          </legend>
                          <div
                            role="radiogroup"
                            aria-label="Search Scope"
                            className="grid gap-2 sm:grid-cols-3"
                          >
                            {SUBDOMAIN_SCOPE_OPTIONS.map((option) => (
                              <label
                                key={option.value}
                                className={cn(
                                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px] text-neutral-300 transition-colors",
                                  subdomainForm.scope === option.value
                                    ? "border-white/[0.18] bg-white/[0.06] text-white"
                                    : "border-white/[0.08] bg-[#0a0a0a] hover:border-white/[0.14] hover:text-white",
                                )}
                              >
                                <input
                                  type="radio"
                                  name="subdomain-scope"
                                  value={option.value}
                                  checked={subdomainForm.scope === option.value}
                                  onChange={() => {
                                    setSubdomainForm((current) => ({
                                      ...current,
                                      scope: option.value,
                                    }));
                                    setSubdomainValidationState({
                                      domain: false,
                                      subdomain: false,
                                    });
                                    if (validationError) {
                                      setValidationError(null);
                                    }
                                  }}
                                  className="size-4 border-white/[0.2] bg-transparent accent-white"
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        <div className="space-y-3">
                          <SubdomainTermRow
                            inputLabel="Domain search terms"
                            inputValue={subdomainForm.domainTerm}
                            inputPlaceholder="example.com or *"
                            modifierValue={subdomainForm.domainModifier}
                            onInputChange={(value) => {
                              setSubdomainForm((current) => ({
                                ...current,
                                domainTerm: value,
                              }));
                              setSubdomainValidationState((current) => ({
                                ...current,
                                domain: false,
                              }));
                              if (validationError) {
                                setValidationError(null);
                              }
                            }}
                            onModifierChange={(value) => {
                              setSubdomainForm((current) => ({
                                ...current,
                                domainModifier: value,
                              }));
                            }}
                            invalid={subdomainValidationState.domain}
                            modifierAriaLabel="Domain modifier"
                          />

                          <SubdomainTermRow
                            inputLabel="Subdomain search terms"
                            inputValue={subdomainForm.subdomainTerm}
                            inputPlaceholder="api, admin, staging"
                            modifierValue={subdomainForm.subdomainModifier}
                            onInputChange={(value) => {
                              setSubdomainForm((current) => ({
                                ...current,
                                subdomainTerm: value,
                              }));
                              setSubdomainValidationState((current) => ({
                                ...current,
                                subdomain: false,
                              }));
                              if (validationError) {
                                setValidationError(null);
                              }
                            }}
                            onModifierChange={(value) => {
                              setSubdomainForm((current) => ({
                                ...current,
                                subdomainModifier: value,
                              }));
                            }}
                            invalid={subdomainValidationState.subdomain}
                            modifierAriaLabel="Subdomain modifier"
                          />
                        </div>

                        <div className="flex flex-col gap-3 border-t border-white/[0.08] pt-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-[12px] leading-5 text-neutral-500">
                            Use <span className="font-mono text-neutral-300">*</span> only as a
                            standalone wildcard to match all subdomains for a domain search. Raw{" "}
                            <span className="font-mono">%</span> and{" "}
                            <span className="font-mono">_</span> are not supported.
                          </p>
                          <Button
                            type="submit"
                            disabled={isLoading}
                            className="h-10 shrink-0 rounded-lg bg-white px-5 text-[13px] font-medium text-black shadow-sm transition-all hover:bg-neutral-200 active:scale-[0.98] disabled:opacity-50"
                          >
                            {isLoading ? "Scanning..." : "Lookup"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          className={cn(
                            "relative flex flex-1 items-center rounded-lg border bg-[#0a0a0a] shadow-sm transition-colors",
                            errorMessage
                              ? "border-destructive/60 focus-within:border-destructive"
                              : "border-white/[0.1] focus-within:border-white/[0.2]",
                          )}
                        >
                          <Search
                            className="pointer-events-none absolute left-3.5 size-4 text-neutral-500"
                            aria-hidden="true"
                          />
                          <input
                            id="lookup-input"
                            type="search"
                            aria-label={tab.inputAriaLabel}
                            aria-invalid={validationError ? true : undefined}
                            value={query}
                            onChange={(event) => {
                              setQuery(event.target.value);
                              if (validationError) {
                                setValidationError(null);
                              }
                            }}
                            placeholder={tab.searchPlaceholder}
                            autoComplete="off"
                            spellCheck={false}
                            className="h-11 w-full min-w-0 bg-transparent pl-10 pr-4 text-[14px] text-white outline-none placeholder:text-neutral-500"
                          />
                        </div>
                        <Button
                          type="submit"
                          disabled={isLoading}
                          className="h-11 shrink-0 rounded-lg bg-white px-6 text-[14px] font-medium text-black shadow-sm transition-all hover:bg-neutral-200 active:scale-[0.98] disabled:opacity-50"
                        >
                          {isLoading ? "Scanning..." : "Lookup"}
                        </Button>
                      </>
                    )}
                  </form>

                  {errorMessage ? (
                    <div className="mt-3 flex max-w-xl items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5">
                      <AlertCircle
                        className="size-4 shrink-0 text-destructive"
                        aria-hidden="true"
                      />
                      <p className="text-[13px] text-destructive">{errorMessage}</p>
                    </div>
                  ) : null}
                </div>

                <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black shadow-2xl shadow-black/50">
                  {showingResults ? (
                    <div className="flex min-h-0 flex-col">
                      <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0a0a0a] px-5 py-4">
                        <div>
                          <h3 className="text-[14px] font-semibold text-white">
                            {tab.resultsHeading}
                          </h3>
                          <p className="mt-0.5 text-[12px] text-neutral-500">
                            {isLoading ? `Scanning ${tab.loadingLabel}...` : activeTarget || "Results"}
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          {!isLoading && hasSearched && !lookupError ? (
                            <StatusBadge tone="neutral">{results.length} found</StatusBadge>
                          ) : null}
                        </div>
                      </div>

                      <div className="bg-black">
                        {isLoading ? (
                          <ResultsTableSkeleton variant={tab.resultMode} />
                        ) : lookupError ? (
                          <EmptyState
                            icon={<AlertCircle className="size-5" />}
                            title="Lookup failed"
                            description={lookupError}
                            tone="danger"
                          />
                        ) : results.length > 0 ? (
                          <>
                            {tab.resultMode === "tech" ? (
                              <TechStackResultsTable
                                results={paginatedResults.filter(isTechDetectionResult)}
                              />
                            ) : (
                              <DnsResultsTable
                                results={paginatedResults.filter(isDnsLookupResult)}
                                columnTitle={tab.resultColumnTitle}
                              />
                            )}
                            {totalPages > 1 ? (
                              <div className="bg-[#0a0a0a]">
                                <Pagination
                                  currentPage={currentPage}
                                  totalPages={totalPages}
                                  onPageChange={setCurrentPage}
                                />
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <EmptyState
                            icon={<Search className="size-5" />}
                            title={tab.noResultsTitle}
                            description={tab.noResultsHint}
                            tone="neutral"
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
                      <div className="flex size-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] shadow-sm">
                        <Search className="size-5 text-neutral-400" aria-hidden="true" />
                      </div>
                      <h3 className="mt-5 text-[15px] font-medium text-white">{tab.emptyPrompt}</h3>
                      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-neutral-500">
                        Results will appear here after a successful lookup. Enter a target in the
                        search bar above to begin.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function hasEffectiveSubdomainPredicate(term: string) {
  return term.replaceAll("*", "").trim().length > 0;
}

function hasUnsupportedSubdomainWildcard(term: string) {
  return term.includes("%") || term.includes("_");
}

function hasInvalidSubdomainAsterisk(term: string) {
  return term.includes("*") && term.trim() !== "*";
}

function formatSubdomainModifierLabel(modifier: SubdomainSearchModifier) {
  return modifier.replaceAll("_", " ");
}

function getSubdomainValidationState(
  scope: SubdomainSearchScope,
  domainTerm: string,
  subdomainTerm: string,
): SubdomainValidationState {
  const hasDomainTerm = hasEffectiveSubdomainPredicate(domainTerm);
  const hasSubdomainTerm = hasEffectiveSubdomainPredicate(subdomainTerm);

  switch (scope) {
    case "domains":
      return {
        domain: !hasDomainTerm,
        subdomain: false,
      };
    case "subdomains":
      return {
        domain: false,
        subdomain: !hasSubdomainTerm,
      };
    default:
      return {
        domain: !hasDomainTerm && !hasSubdomainTerm,
        subdomain: !hasDomainTerm && !hasSubdomainTerm,
      };
  }
}

function getSubdomainScopeValidationMessage(
  scope: SubdomainSearchScope,
  domainTerm: string,
  subdomainTerm: string,
) {
  const hasDomainTerm = hasEffectiveSubdomainPredicate(domainTerm);
  const hasSubdomainTerm = hasEffectiveSubdomainPredicate(subdomainTerm);

  switch (scope) {
    case "domains":
      return hasDomainTerm ? null : EMPTY_DOMAIN_SCOPE_SEARCH_ERROR;
    case "subdomains":
      return hasSubdomainTerm ? null : EMPTY_SUBDOMAIN_SCOPE_SEARCH_ERROR;
    default:
      return hasDomainTerm || hasSubdomainTerm ? null : EMPTY_SUBDOMAIN_SEARCH_ERROR;
  }
}

function buildSubdomainSearchSummary(search: SubdomainSearchFormState) {
  const summaryParts = [`scope: ${search.scope}`];

  if (search.scope !== "subdomains" && hasEffectiveSubdomainPredicate(search.domainTerm)) {
    summaryParts.push(`domain ${formatSubdomainModifierLabel(search.domainModifier)} "${search.domainTerm}"`);
  }

  if (search.scope !== "domains" && hasEffectiveSubdomainPredicate(search.subdomainTerm)) {
    summaryParts.push(
      `subdomain ${formatSubdomainModifierLabel(search.subdomainModifier)} "${search.subdomainTerm}"`,
    );
  }

  return summaryParts.join(" | ");
}

function SubdomainTermRow({
  inputLabel,
  inputValue,
  inputPlaceholder,
  modifierValue,
  onInputChange,
  onModifierChange,
  invalid,
  modifierAriaLabel,
}: {
  inputLabel: string;
  inputValue: string;
  inputPlaceholder: string;
  modifierValue: SubdomainSearchModifier;
  onInputChange: (value: string) => void;
  onModifierChange: (value: SubdomainSearchModifier) => void;
  invalid: boolean;
  modifierAriaLabel: string;
}) {
  const labelSlug = inputLabel.toLowerCase().replaceAll(/\s+/g, "-");

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_168px]">
      <div className="space-y-1.5">
        <label htmlFor={labelSlug} className="text-[12px] font-medium text-neutral-400">
          {inputLabel}
        </label>
        <div
          className={cn(
            "relative flex items-center rounded-lg border bg-[#0a0a0a] shadow-sm transition-colors",
            invalid
              ? "border-destructive/60 focus-within:border-destructive"
              : "border-white/[0.1] focus-within:border-white/[0.2]",
          )}
        >
          <Search
            className="pointer-events-none absolute left-3.5 size-4 text-neutral-500"
            aria-hidden="true"
          />
          <input
            id={labelSlug}
            type="text"
            aria-label={inputLabel}
            aria-invalid={invalid ? true : undefined}
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder={inputPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-full min-w-0 bg-transparent pl-10 pr-4 text-[14px] text-white outline-none placeholder:text-neutral-500"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${labelSlug}-modifier`} className="text-[12px] font-medium text-neutral-400">
          Modifier
        </label>
        <select
          id={`${labelSlug}-modifier`}
          aria-label={modifierAriaLabel}
          value={modifierValue}
          onChange={(event) => onModifierChange(event.target.value as SubdomainSearchModifier)}
          className="h-10 w-full rounded-lg border border-white/[0.1] bg-[#0a0a0a] px-3 text-[13px] text-white outline-none transition-colors focus:border-white/[0.2]"
        >
          {SUBDOMAIN_MODIFIER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} className="bg-[#0a0a0a]">
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function CtSummaryCards({
  summary,
  isLoading,
}: {
  summary: CtAlertSummaryResponse | null;
  isLoading: boolean;
}) {
  const cards = [
    { label: "Alerts", value: summary?.totals.alerts ?? 0 },
    { label: "High severity", value: summary?.totals.highSeverity ?? 0 },
    { label: "Phishing", value: summary?.totals.phishing ?? 0 },
    { label: "Brand protection", value: summary?.totals.brandProtection ?? 0 },
    { label: "Shadow IT", value: summary?.totals.shadowIt ?? 0 },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-white/[0.08] bg-[#080808] px-4 py-4 shadow-lg shadow-black/30"
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
            {card.label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
            {isLoading ? "..." : card.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

function CtFilterBar({
  filters,
  onChange,
}: {
  filters: CtFilterState;
  onChange: <K extends keyof CtFilterState>(key: K, value: CtFilterState[K]) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <FilterSelect
        label="Category"
        value={filters.category}
        options={CT_CATEGORY_OPTIONS}
        onChange={(value) => onChange("category", value as CtFilterCategory)}
      />
      <FilterSelect
        label="Severity"
        value={filters.severity}
        options={CT_SEVERITY_OPTIONS}
        onChange={(value) => onChange("severity", value as CtFilterSeverity)}
      />
      <FilterSelect
        label="Watchlist"
        value={filters.watchType}
        options={CT_WATCH_TYPE_OPTIONS}
        onChange={(value) => onChange("watchType", value as CtFilterWatchType)}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-neutral-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none transition-colors focus:border-white/[0.18]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CtAlertResultsTable({ results }: { results: CtAlertRecord[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[920px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              <th className="px-5 py-2 lg:px-6">Observed</th>
              <th className="px-5 py-2 lg:px-6">Domain</th>
              <th className="px-5 py-2 lg:px-6">Category</th>
              <th className="px-5 py-2 lg:px-6">Severity</th>
              <th className="px-5 py-2 lg:px-6">Matched Term</th>
              <th className="px-5 py-2 lg:px-6">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {results.map((result) => (
              <tr key={result.id} className="transition-colors hover:bg-neutral-900/50">
                <td className="px-5 py-2.5 text-neutral-400 lg:px-6">{result.observedAt}</td>
                <td className="px-5 py-2.5 lg:px-6">
                  <div className="space-y-1">
                    <p className="break-all font-mono text-[13px] text-white">{result.domain}</p>
                    {result.issuerName ? (
                      <p className="text-xs text-neutral-500">{result.issuerName}</p>
                    ) : null}
                  </div>
                </td>
                <td className="px-5 py-2.5 lg:px-6">
                  <StatusBadge tone={ctCategoryToneMap[result.category]}>
                    {formatCtCategory(result.category)}
                  </StatusBadge>
                </td>
                <td className="px-5 py-2.5 lg:px-6">
                  <StatusBadge tone={ctSeverityToneMap[result.severity]}>
                    {formatCtSeverity(result.severity)}
                  </StatusBadge>
                </td>
                <td className="px-5 py-2.5 font-medium text-neutral-200 lg:px-6">
                  {result.matchedTerm}
                </td>
                <td className="px-5 py-2.5 text-neutral-400 lg:px-6">
                  {result.reasons.join(" • ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-px md:hidden" data-testid="ct-alerts-mobile-results">
        {results.map((result) => (
          <div key={`${result.id}-mobile`} className="border-b border-border px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all font-mono text-[13px] text-white">{result.domain}</p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-neutral-500">
                  {result.observedAt}
                </p>
              </div>
              <StatusBadge tone={ctSeverityToneMap[result.severity]}>
                {formatCtSeverity(result.severity)}
              </StatusBadge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge tone={ctCategoryToneMap[result.category]}>
                {formatCtCategory(result.category)}
              </StatusBadge>
              <StatusBadge tone="neutral">{result.matchedTerm}</StatusBadge>
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-400">{result.reasons.join(" • ")}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function CtWatchlistPanel({
  entries,
  error,
  isLoading,
  mutationKey,
  watchTerm,
  watchType,
  watchEnabled,
  onWatchTermChange,
  onWatchTypeChange,
  onWatchEnabledChange,
  onSubmit,
  onToggle,
  onDelete,
}: {
  entries: CtWatchlistEntry[];
  error: string | null;
  isLoading: boolean;
  mutationKey: string | null;
  watchTerm: string;
  watchType: CtWatchType;
  watchEnabled: boolean;
  onWatchTermChange: (value: string) => void;
  onWatchTypeChange: (value: CtWatchType) => void;
  onWatchEnabledChange: (value: boolean) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onToggle: (entry: CtWatchlistEntry) => void;
  onDelete: (entryId: string) => void;
}) {
  return (
    <aside className="rounded-xl border border-white/[0.08] bg-black shadow-2xl shadow-black/50">
      <div className="border-b border-white/[0.08] bg-[#0a0a0a] px-5 py-4">
        <h3 className="text-sm font-semibold text-white">Watchlist Control</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Add the exact brands, internal names, and risky terms that should score new CT hits.
        </p>
      </div>

      <div className="space-y-5 px-5 py-5">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <label className="flex flex-col gap-1.5 text-xs text-neutral-500">
              Watch term
              <input
                value={watchTerm}
                onChange={(event) => onWatchTermChange(event.target.value)}
                placeholder="openai, vpn, grafana"
                className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none transition-colors focus:border-white/[0.18]"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-neutral-500">
              Type
              <select
                value={watchType}
                onChange={(event) => onWatchTypeChange(event.target.value as CtWatchType)}
                className="h-10 rounded-lg border border-white/[0.08] bg-black px-3 text-sm text-white outline-none transition-colors focus:border-white/[0.18]"
              >
                <option value="brand">Brand</option>
                <option value="internal">Internal</option>
                <option value="keyword">Keyword</option>
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={watchEnabled}
                onChange={(event) => onWatchEnabledChange(event.target.checked)}
                className="size-4 rounded border-white/[0.16] bg-black"
              />
              Enabled immediately
            </label>

            <Button
              type="submit"
              disabled={mutationKey === "create"}
              className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200"
            >
              {mutationKey === "create" ? "Adding..." : "Add term"}
            </Button>
          </div>
        </form>

        {error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500">
              Active entries
            </p>
            <StatusBadge tone="neutral">{entries.length}</StatusBadge>
          </div>

          <div className="space-y-2" data-testid="ct-watchlist-panel">
            {isLoading && entries.length === 0 ? (
              <div className="rounded-lg border border-white/[0.08] px-4 py-4 text-sm text-neutral-500">
                Loading watchlists...
              </div>
            ) : entries.length > 0 ? (
              entries.map((entry) => (
                <div
                  key={entry.entryId}
                  className="rounded-lg border border-white/[0.08] bg-[#090909] px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all font-medium text-white">{entry.term}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusBadge tone="neutral">{formatWatchType(entry.watchType)}</StatusBadge>
                        <StatusBadge tone={entry.enabled ? "success" : "warning"}>
                          {entry.enabled ? "Enabled" : "Disabled"}
                        </StatusBadge>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={mutationKey === entry.entryId}
                        onClick={() => onToggle(entry)}
                        className="h-8 rounded-md px-3 text-xs"
                      >
                        {mutationKey === entry.entryId
                          ? "Saving..."
                          : entry.enabled
                            ? "Disable"
                            : "Enable"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={mutationKey === entry.entryId}
                        onClick={() => onDelete(entry.entryId)}
                        className="h-8 rounded-md px-2.5 text-xs text-destructive hover:text-destructive"
                        aria-label={`Delete ${entry.term}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-white/[0.08] px-4 py-4 text-sm text-neutral-500">
                Add a few high-signal terms to start scoring CT alerts.
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function DnsResultsTable({
  results,
  columnTitle,
}: {
  results: SubdomainRecord[];
  columnTitle: string;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[700px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              <th className="px-5 py-2 lg:px-6">{columnTitle}</th>
              <th className="px-5 py-2 lg:px-6">Category</th>
              <th className="px-5 py-2 lg:px-6">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {results.map((result) => (
              <tr key={result.id} className="transition-colors hover:bg-neutral-900/50">
                <td className="px-5 py-2.5 lg:px-6">
                  <span className="break-all font-mono text-[13px] text-foreground">
                    {result.subdomain}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-neutral-400 lg:px-6">{result.type}</td>
                <td className="px-5 py-2.5 lg:px-6">
                  <StatusBadge tone={statusToneMap[result.status]}>{result.status}</StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-px md:hidden" data-testid="results-mobile">
        {results.map((result) => (
          <div
            key={`${result.id}-mobile`}
            className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-[13px] text-foreground">{result.subdomain}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-500">
                {result.type}
              </p>
            </div>
            <StatusBadge tone={statusToneMap[result.status]}>{result.status}</StatusBadge>
          </div>
        ))}
      </div>
    </>
  );
}

function TechStackResultsTable({ results }: { results: TechDetectionResult[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              <th className="px-5 py-2 lg:px-6">Technology</th>
              <th className="px-5 py-2 lg:px-6">Category</th>
              <th className="px-5 py-2 lg:px-6">Confidence</th>
              <th className="px-5 py-2 lg:px-6">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {results.map((result) => (
              <tr key={result.id} className="transition-colors hover:bg-neutral-900/50">
                <td className="px-5 py-2.5 font-medium text-foreground lg:px-6">
                  {result.technology}
                </td>
                <td className="px-5 py-2.5 text-neutral-400 lg:px-6">{result.category}</td>
                <td className="px-5 py-2.5 lg:px-6">
                  <StatusBadge tone={confidenceToneMap[result.confidence]}>
                    {formatConfidence(result.confidence)}
                  </StatusBadge>
                </td>
                <td className="px-5 py-2.5 text-neutral-300 lg:px-6">
                  <div className="space-y-1">
                    {result.evidence.map((evidenceLine) => (
                      <p key={`${result.id}-${evidenceLine}`} className="break-words">
                        {evidenceLine}
                      </p>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-px md:hidden" data-testid="tech-stack-mobile-results">
        {results.map((result) => (
          <div key={`${result.id}-mobile`} className="border-b border-border px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">{result.technology}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-500">
                  {result.category}
                </p>
              </div>
              <StatusBadge tone={confidenceToneMap[result.confidence]}>
                {formatConfidence(result.confidence)}
              </StatusBadge>
            </div>
            <div className="mt-2 space-y-1">
              {result.evidence.map((evidenceLine) => (
                <p
                  key={`${result.id}-${evidenceLine}`}
                  className="break-words text-xs leading-5 text-neutral-400"
                >
                  {evidenceLine}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 lg:px-6">
      <Button
        type="button"
        variant="secondary"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        aria-label="Previous page"
        className="h-7 gap-1 rounded px-2.5 text-xs"
      >
        <ChevronLeft className="size-3.5" aria-hidden="true" />
        Prev
      </Button>
      <p className="text-[11px] tabular-nums text-neutral-500">
        Page {currentPage} of {totalPages}
      </p>
      <Button
        type="button"
        variant="secondary"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
        aria-label="Next page"
        className="h-7 gap-1 rounded px-2.5 text-xs"
      >
        Next
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

function ResultsTableSkeleton({ variant }: { variant: "dns" | "tech" }) {
  return (
    <div className="px-5 py-3 lg:px-6" data-testid="results-skeleton">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={`sk-${index}`} className="flex items-center gap-4 border-b border-border py-2.5">
          <div className="h-3 w-full max-w-[280px] animate-pulse rounded bg-neutral-800" />
          <div className="h-3 w-20 animate-pulse rounded bg-neutral-800" />
          <div className="h-5 w-16 animate-pulse rounded bg-neutral-800" />
          {variant === "tech" ? (
            <div className="h-3 w-40 animate-pulse rounded bg-neutral-800" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  tone,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  tone: "neutral" | "danger";
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-lg",
          tone === "danger"
            ? "bg-destructive/10 text-destructive"
            : "bg-neutral-800/60 text-neutral-500",
        )}
      >
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-md text-xs leading-5 text-neutral-500">{description}</p>
    </div>
  );
}

function isDnsLookupResult(result: LookupResult): result is SubdomainRecord {
  return "subdomain" in result && "status" in result;
}

function isTechDetectionResult(result: LookupResult): result is TechDetectionResult {
  return "technology" in result;
}

function formatConfidence(confidence: TechConfidence) {
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

function formatCtCategory(category: CtAlertCategory) {
  switch (category) {
    case "brand-protection":
      return "Brand Protection";
    case "shadow-it":
      return "Shadow IT";
    default:
      return "Phishing";
  }
}

function formatCtSeverity(severity: CtAlertSeverity) {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function formatWatchType(watchType: CtWatchType) {
  return watchType.charAt(0).toUpperCase() + watchType.slice(1);
}

const statusToneMap: Record<SubdomainStatus, "neutral" | "success" | "warning"> = {
  Primary: "success",
  Live: "neutral",
  Review: "warning",
  Watch: "warning",
  Edge: "neutral",
  Service: "neutral",
};

const confidenceToneMap: Record<TechConfidence, "neutral" | "success" | "warning"> = {
  high: "success",
  medium: "warning",
  low: "neutral",
};

const ctCategoryToneMap: Record<CtAlertCategory, "neutral" | "success" | "warning"> = {
  phishing: "warning",
  "brand-protection": "neutral",
  "shadow-it": "success",
};

const ctSeverityToneMap: Record<CtAlertSeverity, "neutral" | "success" | "warning"> = {
  high: "warning",
  medium: "neutral",
};
