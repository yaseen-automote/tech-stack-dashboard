import { NextResponse } from "next/server";

import { getBulkApiBaseUrl } from "@/lib/bulk-api";

type RouteContext = {
  params: Promise<{
    entryId: string;
  }>;
};

async function readJsonBody(request: Request) {
  return (await request.json().catch(() => null)) as Record<string, unknown> | null;
}

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: RouteContext) {
  const { entryId } = await context.params;
  const body = await readJsonBody(request);

  try {
    const response = await fetch(new URL(`/v1/ct/watchlists/${entryId}`, getBulkApiBaseUrl()), {
      method: "PATCH",
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
        { error: payload.error ?? "The CT watchlist entry could not be updated." },
        { status },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "The CT watchlist entry could not be updated." },
      { status: 502 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { entryId } = await context.params;

  try {
    const response = await fetch(new URL(`/v1/ct/watchlists/${entryId}`, getBulkApiBaseUrl()), {
      method: "DELETE",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const status = response.status >= 500 ? 502 : response.status;
      return NextResponse.json(
        { error: payload.error ?? "The CT watchlist entry could not be deleted." },
        { status },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "The CT watchlist entry could not be deleted." },
      { status: 502 },
    );
  }
}
