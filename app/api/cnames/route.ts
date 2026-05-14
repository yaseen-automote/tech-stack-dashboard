import { NextResponse } from "next/server";
import { isValidDomain, normalizeDomainInput } from "@/lib/subdomain-intelligence";

export const dynamic = "force-dynamic";

const INVALID_DOMAIN_ERROR = "Enter a valid domain to inspect CNAME records.";

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const normalizedDomain = normalizeDomainInput(url.searchParams.get("domain") ?? "");

  if (!isValidDomain(normalizedDomain)) {
    return NextResponse.json({ error: INVALID_DOMAIN_ERROR }, { status: 400 });
  }

  const baseUrl = process.env.THC_API_BASE_URL || "https://ip.thc.org";
  const upstreamUrl = `${baseUrl}/api/v1/lookup/cnames`;

  try {
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain",
      "Content-Type": "application/json",
    };
    
    if (process.env.THC_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.THC_API_KEY}`;
    }

    const response = await fetch(upstreamUrl, {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({
        target_domain: normalizedDomain,
      }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "The upstream CNAME dataset is unavailable right now." },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as UpstreamCnamePayload;
    const results = extractCnameResults(payload);

    return NextResponse.json({
      domain: normalizedDomain,
      results: results.map((subdomain, index) => ({
        id: `${subdomain}-${index}`,
        subdomain,
        type: "CNAME",
        status: "Live",
      })),
    });
  } catch {
    return NextResponse.json(
      { error: "The CNAME lookup request could not be completed." },
      { status: 502 },
    );
  }
}

function extractCnameResults(payload: UpstreamCnamePayload) {
  const items = Array.isArray(payload)
    ? payload
    : payload.results ?? payload.data ?? payload.domains ?? [];

  return items
    .map((item) => normalizeCnameResult(item))
    .filter((item): item is string => item !== null);
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

  if (!candidate) {
    return null;
  }

  return normalizeDomainInput(candidate);
}
