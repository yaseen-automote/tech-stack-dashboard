import { NextResponse } from "next/server";
import { isValidIpAddress, normalizeIpInput } from "@/lib/subdomain-intelligence";

export const dynamic = "force-dynamic";

const INVALID_IP_ERROR = "Enter a valid IP address to inspect reverse DNS records.";

type UpstreamReverseDnsItem =
  | string
  | {
      domain?: string;
      hostname?: string;
      name?: string;
      host?: string;
    };

type UpstreamReverseDnsPayload =
  | UpstreamReverseDnsItem[]
  | {
      results?: UpstreamReverseDnsItem[];
      data?: UpstreamReverseDnsItem[];
      domains?: UpstreamReverseDnsItem[];
      hostnames?: UpstreamReverseDnsItem[];
    };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const normalizedIp = normalizeIpInput(url.searchParams.get("ip") ?? "");

  if (!isValidIpAddress(normalizedIp)) {
    return NextResponse.json({ error: INVALID_IP_ERROR }, { status: 400 });
  }

  const baseUrl = process.env.THC_API_BASE_URL || "https://ip.thc.org";
  const upstreamUrl = `${baseUrl}/api/v1/lookup`;

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
        ip_address: normalizedIp,
        tld: ["com"],
        apex_domain: "",
        page_state: "",
        limit: 10,
      }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "The upstream reverse DNS dataset is unavailable right now." },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as UpstreamReverseDnsPayload;
    const results = extractReverseDnsResults(payload);

    return NextResponse.json({
      domain: normalizedIp,
      results: results.map((subdomain, index) => ({
        id: `${subdomain}-${index}`,
        subdomain,
        type: "Reverse DNS",
        status: "Live",
      })),
    });
  } catch {
    return NextResponse.json(
      { error: "The reverse DNS lookup request could not be completed." },
      { status: 502 },
    );
  }
}

function extractReverseDnsResults(payload: UpstreamReverseDnsPayload) {
  const items = Array.isArray(payload)
    ? payload
    : payload.results ?? payload.data ?? payload.domains ?? payload.hostnames ?? [];

  return items
    .map((item) => normalizeReverseDnsResult(item))
    .filter((item): item is string => item !== null);
}

function normalizeReverseDnsResult(item: UpstreamReverseDnsItem) {
  if (typeof item === "string") {
    return item.trim().toLowerCase();
  }

  const candidate = item.domain ?? item.hostname ?? item.name ?? item.host;

  if (!candidate) {
    return null;
  }

  return candidate.trim().toLowerCase();
}
