import { NextResponse } from "next/server";
import {
  isValidDomain,
  normalizeDomainInput,
} from "@/lib/subdomain-intelligence";
import { getBulkApiBaseUrl } from "@/lib/bulk-api";

export const dynamic = "force-dynamic";

const INVALID_DOMAIN_ERROR =
  "Enter a valid domain to inspect subdomain infrastructure.";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const normalizedDomain = normalizeDomainInput(url.searchParams.get("domain") ?? "");

  if (!isValidDomain(normalizedDomain)) {
    return NextResponse.json({ error: INVALID_DOMAIN_ERROR }, { status: 400 });
  }

  const upstreamUrl = new URL("/v1/subdomains", getBulkApiBaseUrl());
  upstreamUrl.searchParams.set("domain", normalizedDomain);
  upstreamUrl.searchParams.set("limit", "100");

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
