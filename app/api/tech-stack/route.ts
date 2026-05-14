import { NextResponse } from "next/server";
import { evaluateTechStackSignals } from "@/lib/tech-stack/evaluator";
import { normalizeTechStackTarget } from "@/lib/tech-stack/normalize";
import { scanTechStackTarget } from "@/lib/tech-stack/scanner";

export const dynamic = "force-dynamic";

const INVALID_TARGET_ERROR =
  "Enter a valid domain or URL to inspect the website tech stack.";
const SCAN_FAILURE_ERROR = "The tech stack scan could not be completed right now.";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const normalizedTarget = normalizeTechStackTarget(url.searchParams.get("target") ?? "");

  if (!normalizedTarget) {
    return NextResponse.json({ error: INVALID_TARGET_ERROR }, { status: 400 });
  }

  try {
    const signals = await scanTechStackTarget(normalizedTarget);
    const results = evaluateTechStackSignals(signals);

    return NextResponse.json({
      target: normalizedTarget.displayTarget,
      results,
    });
  } catch {
    return NextResponse.json({ error: SCAN_FAILURE_ERROR }, { status: 502 });
  }
}
