import { NextResponse } from "next/server";

import { getBulkApiBaseUrl } from "@/lib/bulk-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(new URL("/v1/ct/alerts/summary", getBulkApiBaseUrl()), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error ?? "The CT alert summary is unavailable right now." },
        { status: 502 },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "The CT alert summary request could not be completed." },
      { status: 502 },
    );
  }
}
