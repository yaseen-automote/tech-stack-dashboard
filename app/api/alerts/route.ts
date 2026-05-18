import { NextResponse } from "next/server";

import { getBulkApiBaseUrl } from "@/lib/bulk-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL("/v1/ct/alerts", getBulkApiBaseUrl());

  for (const [key, value] of requestUrl.searchParams.entries()) {
    upstreamUrl.searchParams.set(key, value);
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
      const status = response.status >= 500 ? 502 : response.status;

      return NextResponse.json(
        { error: payload.error ?? "The CT alert dataset is unavailable right now." },
        { status },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "The CT alert lookup request could not be completed." },
      { status: 502 },
    );
  }
}
