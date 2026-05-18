import { NextResponse } from "next/server";
import { normalizeDomainInput } from "@/lib/subdomain-intelligence";
import { getBulkApiBaseUrl } from "@/lib/bulk-api";

export const dynamic = "force-dynamic";

type SubdomainSearchScope = "domains" | "subdomains" | "both";
type SubdomainSearchModifier = "starts_with" | "ends_with" | "contains";

const DEFAULT_SUBDOMAIN_LIMIT = 100;
const INVALID_SCOPE_ERROR = "Select a valid subdomain search scope.";
const INVALID_DOMAIN_MODIFIER_ERROR = "Select a valid domain search modifier.";
const INVALID_SUBDOMAIN_MODIFIER_ERROR = "Select a valid subdomain search modifier.";
const INVALID_WILDCARD_ERROR =
  "Use * as the only wildcard in domain and subdomain search terms.";
const EMPTY_SEARCH_ERROR =
  "Enter at least one domain or subdomain search term to inspect subdomain infrastructure.";

const VALID_SCOPES = new Set<SubdomainSearchScope>(["domains", "subdomains", "both"]);
const VALID_MODIFIERS = new Set<SubdomainSearchModifier>([
  "starts_with",
  "ends_with",
  "contains",
]);

function normalizeSearchTerm(value: string | null) {
  return normalizeDomainInput(value ?? "");
}

function normalizeSearchScope(value: string | null) {
  if (!value) {
    return "both" as const;
  }

  return VALID_SCOPES.has(value as SubdomainSearchScope) ? (value as SubdomainSearchScope) : null;
}

function normalizeSearchModifier(value: string | null) {
  if (!value) {
    return "contains" as const;
  }

  return VALID_MODIFIERS.has(value as SubdomainSearchModifier)
    ? (value as SubdomainSearchModifier)
    : null;
}

function hasEffectivePredicate(term: string) {
  return term.replaceAll("*", "").trim().length > 0;
}

function hasUnsupportedWildcard(term: string) {
  return term.includes("%") || term.includes("_");
}

function normalizeLimit(value: string | null, fallback = DEFAULT_SUBDOMAIN_LIMIT, max = 500) {
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = normalizeSearchScope(url.searchParams.get("scope"));
  const domainTerm = normalizeSearchTerm(url.searchParams.get("domainTerm"));
  const domainModifier = normalizeSearchModifier(url.searchParams.get("domainModifier"));
  const subdomainTerm = normalizeSearchTerm(url.searchParams.get("subdomainTerm"));
  const subdomainModifier = normalizeSearchModifier(url.searchParams.get("subdomainModifier"));
  const limit = normalizeLimit(url.searchParams.get("limit"));

  if (scope === null) {
    return NextResponse.json({ error: INVALID_SCOPE_ERROR }, { status: 400 });
  }

  if (domainModifier === null) {
    return NextResponse.json({ error: INVALID_DOMAIN_MODIFIER_ERROR }, { status: 400 });
  }

  if (subdomainModifier === null) {
    return NextResponse.json({ error: INVALID_SUBDOMAIN_MODIFIER_ERROR }, { status: 400 });
  }

  if (hasUnsupportedWildcard(domainTerm) || hasUnsupportedWildcard(subdomainTerm)) {
    return NextResponse.json({ error: INVALID_WILDCARD_ERROR }, { status: 400 });
  }

  if (!hasEffectivePredicate(domainTerm) && !hasEffectivePredicate(subdomainTerm)) {
    return NextResponse.json({ error: EMPTY_SEARCH_ERROR }, { status: 400 });
  }

  const upstreamUrl = new URL("/v1/subdomains", getBulkApiBaseUrl());
  upstreamUrl.searchParams.set("scope", scope);
  upstreamUrl.searchParams.set("domainTerm", domainTerm);
  upstreamUrl.searchParams.set("domainModifier", domainModifier);
  upstreamUrl.searchParams.set("subdomainTerm", subdomainTerm);
  upstreamUrl.searchParams.set("subdomainModifier", subdomainModifier);
  if (typeof limit === "number") {
    upstreamUrl.searchParams.set("limit", String(limit));
  }

  try {
    const response = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error ?? "The bulk subdomain dataset is unavailable right now." },
        { status: 502 },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "The subdomain lookup request could not be completed." },
      { status: 502 },
    );
  }
}
