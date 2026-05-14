"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Search, Radar } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { LookupWorkspaceSidebar, type TabId } from "@/components/ui/sidebar-component";
import {
  isValidIpAddress,
  isValidDomain,
  normalizeIpInput,
  normalizeDomainInput,
  type SubdomainRecord,
  type SubdomainStatus,
} from "@/lib/subdomain-intelligence";
import {
  normalizeTechStackTarget,
} from "@/lib/tech-stack/normalize";
import type { TechConfidence, TechDetectionResult } from "@/lib/tech-stack/types";
import { cn } from "@/lib/utils";

const RESULTS_PER_PAGE = 20;

type LookupResult = SubdomainRecord | TechDetectionResult;

type SearchRequest = {
  target: string;
  token: number;
};

type LookupApiResponse = {
  domain?: string;
  target?: string;
  results: LookupResult[];
  error?: string;
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

const TAB_COPY: Record<TabId, TabConfig> = {
  subdomain: {
    label: "Subdomain Lookup",
    inputAriaLabel: "Search or inspect a domain",
    searchPlaceholder: "Enter a domain, e.g. stripe.com",
    endpoint: "/api/subdomains",
    queryParam: "domain",
    resultsHeading: "Subdomain Results",
    resultColumnTitle: "Subdomain",
    noResultsTitle: "No results",
    noResultsHint:
      "Try another apex domain, or verify that the upstream dataset has indexed it.",
    loadingLabel: "subdomains",
    emptyPrompt: "Enter a domain above to start",
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
};

export function DashboardShell() {
  const [query, setQuery] = useState("");
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const [results, setResults] = useState<LookupResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [announcement, setAnnouncement] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("subdomain");

  const tab = TAB_COPY[activeTab];

  useEffect(() => {
    if (!searchRequest) {
      return;
    }

    const target = searchRequest.target;
    const abortController = new AbortController();
    let isCancelled = false;

    async function fetchResults() {
      setIsLoading(true);
      setLookupError(null);
      setValidationError(null);
      setAnnouncement(`Searching for ${tab.loadingLabel} for ${target}...`);

      try {
        const response = await fetch(
          `${tab.endpoint}?${tab.queryParam}=${encodeURIComponent(target)}`,
          { signal: abortController.signal, cache: "no-store" },
        );
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
  }, [searchRequest, tab]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(results.length / RESULTS_PER_PAGE)),
    [results.length],
  );

  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * RESULTS_PER_PAGE;
    return results.slice(start, start + RESULTS_PER_PAGE);
  }, [currentPage, results]);

  const hasSearched = searchRequest !== null;
  const activeTarget = searchRequest?.target ?? "";
  const showingResults = hasSearched || isLoading || lookupError !== null;
  const errorMessage = validationError ?? lookupError;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedTarget = tab.normalizeQuery(query);
    if (!normalizedTarget) {
      const message = tab.buildValidationMessage();
      setValidationError(message);
      setLookupError(null);
      setAnnouncement(`Error: ${message}`);
      return;
    }

    setQuery(normalizedTarget);
    setValidationError(null);
    setSearchRequest({
      target: normalizedTarget,
      token: Date.now(),
    });
  }

  function switchTab(nextTab: TabId) {
    if (nextTab === activeTab) {
      return;
    }

    setActiveTab(nextTab);
    setQuery("");
    setSearchRequest(null);
    setResults([]);
    setLookupError(null);
    setValidationError(null);
    setCurrentPage(1);
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
              <span className="text-[14px] font-medium tracking-tight text-white">
                Automote
              </span>
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
                        : "border-transparent text-neutral-500 hover:border-neutral-700 hover:text-neutral-300"
                    )}
                  >
                    {config.label}
                  </button>
               ))}
            </div>
          </nav>
        </header>

        <main id="main-content" className="flex-1 min-w-0 p-4 sm:p-5 lg:p-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-8 max-w-2xl">
              <h2 className="text-[clamp(1.5rem,3vw,2rem)] font-bold tracking-tight text-white">{tab.label}</h2>
              
              <form
                role="search"
                aria-label={tab.label}
                onSubmit={handleSubmit}
                className="mt-6 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-center"
              >
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
                    aria-invalid={errorMessage ? true : undefined}
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
                  className="h-11 shrink-0 rounded-lg bg-white px-6 text-[14px] font-medium text-black transition-all hover:bg-neutral-200 active:scale-[0.98] disabled:opacity-50 shadow-sm"
                >
                  {isLoading ? "Scanning..." : "Lookup"}
                </Button>
              </form>

              {errorMessage ? (
                <div className="mt-3 flex max-w-xl items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5">
                  <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <p className="text-[13px] text-destructive">{errorMessage}</p>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-black overflow-hidden shadow-2xl shadow-black/50">
              {showingResults ? (
                <div className="flex min-h-0 flex-col">
                  <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0a0a0a] px-5 py-4">
                    <div>
                      <h3 className="text-[14px] font-semibold text-white">
                        {tab.resultsHeading}
                      </h3>
                      <p className="mt-0.5 text-[12px] text-neutral-500">
                        {isLoading
                          ? `Scanning ${tab.loadingLabel}...`
                          : activeTarget || "Results"}
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
                    Results will appear here after a successful lookup. Enter a target in the search bar above to begin.
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
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
                <td className="px-5 py-2.5 lg:px-6 text-neutral-400">{result.type}</td>
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
              <p className="truncate font-mono text-[13px] text-foreground">
                {result.subdomain}
              </p>
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
          <div
            key={`${result.id}-mobile`}
            className="border-b border-border px-4 py-3"
          >
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
        <div
          key={`sk-${index}`}
          className="flex items-center gap-4 border-b border-border py-2.5"
        >
          <div className="h-3 w-full max-w-[280px] rounded bg-neutral-800 animate-pulse" />
          <div className="h-3 w-20 rounded bg-neutral-800 animate-pulse" />
          <div className="h-5 w-16 rounded bg-neutral-800 animate-pulse" />
          {variant === "tech" ? (
            <div className="h-3 w-40 rounded bg-neutral-800 animate-pulse" />
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
