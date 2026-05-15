import { NextResponse } from "next/server";
import { isValidIpAddress, normalizeIpInput } from "@/lib/subdomain-intelligence";
import { getBulkApiBaseUrl } from "@/lib/bulk-api";

export const dynamic = "force-dynamic";

const INVALID_IP_ERROR = "Enter a valid IP address to inspect reverse DNS records.";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const normalizedIp = normalizeIpInput(url.searchParams.get("ip") ?? "");

  if (!isValidIpAddress(normalizedIp)) {
    return NextResponse.json({ error: INVALID_IP_ERROR }, { status: 400 });
  }

  const upstreamUrl = new URL("/v1/reverse-ip", getBulkApiBaseUrl());
  upstreamUrl.searchParams.set("ip", normalizedIp);
  upstreamUrl.searchParams.set("limit", "10");

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
        { error: payload.error ?? "The bulk reverse DNS dataset is unavailable right now." },
        { status: 502 },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "The reverse DNS lookup request could not be completed." },
      { status: 502 },
    );
  }
}
