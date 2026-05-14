import { NextResponse } from "next/server";
import {
  isValidDomain,
  normalizeDomainInput,
  parseSubdomainResponse,
} from "@/lib/subdomain-intelligence";

export const dynamic = "force-dynamic";

const INVALID_DOMAIN_ERROR =
  "Enter a valid domain to inspect subdomain infrastructure.";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const normalizedDomain = normalizeDomainInput(url.searchParams.get("domain") ?? "");

  if (!isValidDomain(normalizedDomain)) {
    return NextResponse.json({ error: INVALID_DOMAIN_ERROR }, { status: 400 });
  }

  const baseUrl = process.env.THC_API_BASE_URL || "https://ip.thc.org";
  const upstreamUrl = new URL(`${baseUrl}/sb/${normalizedDomain}`);
  upstreamUrl.searchParams.set("nocolor", "1");
  upstreamUrl.searchParams.set("noheader", "1");

  try {
    const headers: Record<string, string> = {
      Accept: "text/plain, application/json",
    };
    
    if (process.env.THC_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.THC_API_KEY}`;
    }

    const response = await fetch(upstreamUrl, {
      cache: "no-store",
      headers,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "The upstream subdomain dataset is unavailable right now." },
        { status: 502 },
      );
    }

    // The sb endpoint is CLI-oriented and currently returns newline-delimited text,
    // even when the content-type header advertises application/json.
    const results = parseSubdomainResponse(await response.text(), normalizedDomain);

    return NextResponse.json({
      domain: normalizedDomain,
      results,
    });
  } catch {
    return NextResponse.json(
      { error: "The subdomain lookup request could not be completed." },
      { status: 502 },
    );
  }
}
