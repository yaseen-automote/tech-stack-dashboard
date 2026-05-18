import { NextResponse } from "next/server";

import { getBulkApiBaseUrl } from "@/lib/bulk-api";

export const dynamic = "force-dynamic";

async function readJsonBody(request: Request) {
  return (await request.json().catch(() => null)) as Record<string, unknown> | null;
}

export async function GET() {
  try {
    const response = await fetch(new URL("/v1/ct/watchlists", getBulkApiBaseUrl()), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      return NextResponse.json(
        { error: payload.error ?? "The CT watchlist is unavailable right now." },
        { status },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "The CT watchlist request could not be completed." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const body = await readJsonBody(request);

  try {
    const response = await fetch(new URL("/v1/ct/watchlists", getBulkApiBaseUrl()), {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      return NextResponse.json(
        { error: payload.error ?? "The CT watchlist entry could not be created." },
        { status },
      );
    }

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "The CT watchlist entry could not be created." },
      { status: 502 },
    );
  }
}
