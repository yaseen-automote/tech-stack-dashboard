# Tech Stack Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synchronous `Tech Stack` lookup tab that scans a website, detects technologies from HTTP and DNS signals, and renders categorized detections with confidence and evidence.

**Architecture:** Keep `app/api/tech-stack/route.ts` thin and move logic into `lib/tech-stack/*` modules. The scanner collects normalized signals from the homepage, a small smart-probe set, and DNS lookups; the evaluator applies code-defined seed rules and returns deduplicated detections that the dashboard renders in a tab-specific table.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, React Testing Library, existing lookup dashboard UI, native `fetch`, and Node DNS promises.

---

## File Map

- Create: `lib/tech-stack/types.ts`
  Shared categories, confidence levels, signal models, matcher definitions, and API result types.
- Create: `lib/tech-stack/normalize.ts`
  Domain-or-URL normalization and validation helpers for the tech-stack tab.
- Create: `lib/tech-stack/normalize.test.ts`
  Unit tests for domain and URL normalization.
- Create: `lib/tech-stack/scanner.ts`
  Homepage fetch, smart probes, DNS collection, and HTML signal extraction orchestration.
- Create: `lib/tech-stack/scanner.test.ts`
  Unit tests for signal extraction, probe handling, and DNS fault tolerance.
- Create: `lib/tech-stack/rules.ts`
  Code-defined seed rules.
- Create: `lib/tech-stack/evaluator.ts`
  Matcher application, evidence generation, confidence ranking, and deduplication.
- Create: `lib/tech-stack/evaluator.test.ts`
  Unit tests for matcher families and deduplication.
- Create: `app/api/tech-stack/route.ts`
  API route that validates input, runs the scanner/evaluator, and returns normalized detections.
- Create: `app/api/tech-stack/route.test.ts`
  API route tests for invalid input, success, and partial failure handling.
- Modify: `components/ui/sidebar-component.tsx`
  Add the `Tech Stack` tab to the sidebar.
- Modify: `components/dashboard-shell.tsx`
  Add a tech-stack tab mode, input copy, endpoint selection, and tech-stack result rendering.
- Modify: `app-shell.test.tsx`
  Add UI tests for the new tab and result rendering.

## Task 1: Shared Types And Input Normalization

**Files:**
- Create: `lib/tech-stack/types.ts`
- Create: `lib/tech-stack/normalize.ts`
- Create: `lib/tech-stack/normalize.test.ts`

- [ ] **Step 1: Write failing normalization tests**

```ts
import {
  isValidTechStackTarget,
  normalizeTechStackTarget,
} from "@/lib/tech-stack/normalize";

describe("normalizeTechStackTarget", () => {
  it("accepts a bare domain and normalizes it to https", () => {
    expect(normalizeTechStackTarget("stripe.com")).toEqual({
      rawInput: "stripe.com",
      canonicalHostname: "stripe.com",
      normalizedUrl: "https://stripe.com",
      displayTarget: "stripe.com",
    });
  });

  it("accepts a full URL and preserves its pathless origin target", () => {
    expect(normalizeTechStackTarget("https://www.shopify.com/pricing?x=1")).toEqual({
      rawInput: "https://www.shopify.com/pricing?x=1",
      canonicalHostname: "www.shopify.com",
      normalizedUrl: "https://www.shopify.com",
      displayTarget: "www.shopify.com",
    });
  });
});

describe("isValidTechStackTarget", () => {
  it("accepts valid domains and URLs", () => {
    expect(isValidTechStackTarget("vercel.com")).toBe(true);
    expect(isValidTechStackTarget("https://vercel.com")).toBe(true);
  });

  it("rejects invalid targets", () => {
    expect(isValidTechStackTarget("not a target")).toBe(false);
    expect(isValidTechStackTarget("ftp://example.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/tech-stack/normalize.test.ts`
Expected: FAIL because `lib/tech-stack/normalize.ts` does not exist yet.

- [ ] **Step 3: Write minimal shared tech-stack types and normalization helpers**

Create `lib/tech-stack/types.ts` with:

```ts
export type TechCategory =
  | "Frontend / UI"
  | "Framework / Runtime"
  | "Analytics / Tag Manager"
  | "Payments / Widgets"
  | "CDN / WAF"
  | "Hosting / Cloud"
  | "DNS / Mail / Security"
  | "CMS / Metadata";

export type TechConfidence = "high" | "medium" | "low";

export type NormalizedTechStackTarget = {
  rawInput: string;
  canonicalHostname: string;
  normalizedUrl: string;
  displayTarget: string;
};
```

Create `lib/tech-stack/normalize.ts` with:

```ts
import { isValidDomain, normalizeDomainInput } from "@/lib/subdomain-intelligence";
import type { NormalizedTechStackTarget } from "@/lib/tech-stack/types";

export function normalizeTechStackTarget(input: string): NormalizedTechStackTarget | null {
  const rawInput = input.trim();

  if (rawInput.length === 0) {
    return null;
  }

  if (isValidDomain(normalizeDomainInput(rawInput))) {
    const canonicalHostname = normalizeDomainInput(rawInput);
    return {
      rawInput,
      canonicalHostname,
      normalizedUrl: `https://${canonicalHostname}`,
      displayTarget: canonicalHostname,
    };
  }

  try {
    const url = new URL(rawInput);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    const canonicalHostname = normalizeDomainInput(url.hostname);
    if (!isValidDomain(canonicalHostname)) {
      return null;
    }

    return {
      rawInput,
      canonicalHostname,
      normalizedUrl: `${url.protocol}//${canonicalHostname}`,
      displayTarget: canonicalHostname,
    };
  } catch {
    return null;
  }
}

export function isValidTechStackTarget(input: string) {
  return normalizeTechStackTarget(input) !== null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/tech-stack/normalize.test.ts`
Expected: PASS

## Task 2: Scanner Signal Collection

**Files:**
- Create: `lib/tech-stack/scanner.ts`
- Create: `lib/tech-stack/scanner.test.ts`
- Modify: `lib/tech-stack/types.ts`

- [ ] **Step 1: Write failing scanner tests**

Add tests for:
- homepage signal extraction from headers, HTML, scripts, links, and meta
- smart probe continuation when one probe fails
- DNS collection continuation when one record type rejects

Key expectations:

```ts
expect(result.http.headers.server).toBe("cloudflare");
expect(result.http.scriptSrcs).toContain("https://js.stripe.com/v3");
expect(result.http.meta.generator).toBe("WordPress");
expect(result.probes["/robots.txt"]?.ok).toBe(true);
expect(result.dns.ns).toContain("alice.ns.cloudflare.com");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/tech-stack/scanner.test.ts`
Expected: FAIL because `scanTechStackTarget` does not exist yet.

- [ ] **Step 3: Implement the scanner**

Create:
- HTML extractors using regex helpers for `script src`, inline script blocks, `link href`, and `meta`
- homepage fetch with redirect-following behavior
- probe fetches for `/robots.txt`, `/favicon.ico`, `/.well-known/security.txt`, `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association`
- DNS resolution via `node:dns/promises`
- graceful fallback on probe or DNS failures

Suggested public API:

```ts
export async function scanTechStackTarget(
  target: NormalizedTechStackTarget,
  options?: Partial<TechStackScannerOptions>,
): Promise<TechStackScanSignals>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/tech-stack/scanner.test.ts`
Expected: PASS

## Task 3: Seed Rules And Evaluator

**Files:**
- Create: `lib/tech-stack/rules.ts`
- Create: `lib/tech-stack/evaluator.ts`
- Create: `lib/tech-stack/evaluator.test.ts`
- Modify: `lib/tech-stack/types.ts`

- [ ] **Step 1: Write failing evaluator tests**

Cover:
- `header-contains`
- `script-src-regex`
- `link-href-regex`
- `html-regex`
- `cookie-name`
- `meta-generator-contains`
- `dns-pattern`
- `security-header-present`
- `combined`
- deduplication for multiple rules matching the same technology

Representative assertion:

```ts
expect(results).toContainEqual(
  expect.objectContaining({
    technology: "Cloudflare",
    category: "CDN / WAF",
    confidence: "high",
  }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/tech-stack/evaluator.test.ts`
Expected: FAIL because the evaluator and rules do not exist yet.

- [ ] **Step 3: Implement rule types, seed rules, and evaluation**

Add:
- matcher type definitions
- approximately 20-30 curated rules for the approved v1 set
- confidence ranking helper
- evidence generation helper
- technology-based deduplication with evidence merging

Suggested public API:

```ts
export function evaluateTechStackSignals(
  signals: TechStackScanSignals,
  rules = techDetectionRules,
): TechDetectionResult[]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/tech-stack/evaluator.test.ts`
Expected: PASS

## Task 4: API Route

**Files:**
- Create: `app/api/tech-stack/route.ts`
- Create: `app/api/tech-stack/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover:
- invalid target returns `400`
- successful scan returns `{ target, results }`
- scanner success with DNS partial failure still returns detections
- scan failure returns `502`

Representative assertion:

```ts
await expect(response.json()).resolves.toEqual({
  target: "stripe.com",
  results: [
    expect.objectContaining({
      technology: "Stripe",
      category: "Payments / Widgets",
      confidence: "high",
    }),
  ],
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/api/tech-stack/route.test.ts`
Expected: FAIL because the route does not exist yet.

- [ ] **Step 3: Implement the route**

Route behavior:
- read `target` query param
- validate with `normalizeTechStackTarget`
- run `scanTechStackTarget`
- evaluate with `evaluateTechStackSignals`
- return:

```ts
{
  target: normalized.displayTarget,
  results,
}
```

Error messages:
- invalid target: `Enter a valid domain or URL to inspect the website tech stack.`
- upstream/scan failure: `The tech stack scan could not be completed right now.`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/api/tech-stack/route.test.ts`
Expected: PASS

## Task 5: Sidebar And Dashboard Integration

**Files:**
- Modify: `components/ui/sidebar-component.tsx`
- Modify: `components/dashboard-shell.tsx`
- Modify: `app-shell.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests for:
- `Tech Stack` appears in the sidebar
- switching tabs updates placeholder and form label
- tech-stack submit calls `/api/tech-stack?target=...`
- tech detections render with technology, category, confidence, and evidence
- no-results state uses tech-stack-specific copy

Representative fetch assertion:

```ts
expect(global.fetch).toHaveBeenCalledWith(
  "/api/tech-stack?target=stripe.com",
  expect.objectContaining({ cache: "no-store" }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app-shell.test.tsx`
Expected: FAIL because the tab and result rendering do not exist yet.

- [ ] **Step 3: Implement the UI integration**

Sidebar:
- extend `TabId` with `tech-stack`
- add a `Tech Stack` nav item

Dashboard:
- add tab config for the tech-stack mode
- validate domain-or-URL input with the new helpers
- call `/api/tech-stack`
- render a tech-stack-specific results table on desktop
- render tech-stack result cards on mobile
- keep the existing subdomain, CNAME, and reverse DNS flows unchanged

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app-shell.test.tsx`
Expected: PASS

## Task 6: Full Verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run the focused tech-stack tests**

Run:

```bash
npm test -- lib/tech-stack/normalize.test.ts lib/tech-stack/scanner.test.ts lib/tech-stack/evaluator.test.ts app/api/tech-stack/route.test.ts app-shell.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS

- [ ] **Step 4: Note repository limitation**

Document in the final summary that the workspace currently is not a Git repository, so no commit step could be executed even though the normal workflow would include frequent commits.
