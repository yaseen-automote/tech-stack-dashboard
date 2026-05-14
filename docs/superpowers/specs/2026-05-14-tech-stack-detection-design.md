# Tech Stack Detection Design

Date: 2026-05-14
Status: Approved design, pending implementation plan

## Summary

Add a new `Tech Stack` lookup tab that analyzes a website and returns detected technologies with category, confidence, and evidence. The first release is synchronous and request-driven, matching the existing lookup experience used for subdomain, CNAME, and reverse DNS results.

The feature should accept either a domain or a full website URL, normalize the input internally, collect website and DNS signals, apply code-defined seed rules, and render categorized detections immediately in the dashboard.

## Goals

- Add a `Tech Stack` tab to the existing sidebar and lookup shell.
- Accept either a full URL or a bare domain as input.
- Run a single-request synchronous scan with immediate results.
- Detect technologies from HTTP, HTML, probe responses, cookies, headers, and DNS records.
- Classify detections into meaningful product categories.
- Return confidence and human-readable evidence for each detection.
- Keep the architecture modular so the ruleset and scanner can expand later.

## Non-Goals

- No async job queue or background processing in v1.
- No full crawler or deep site exploration in v1.
- No historical scan storage, comparisons, or scan history in v1.
- No external vendor integration such as BuiltWith or Wappalyzer APIs.
- No giant ruleset in v1; prioritize a smaller, higher-precision seed set.

## Product Behavior

### User Flow

1. User selects the `Tech Stack` tab in the sidebar.
2. User enters either a URL like `https://stripe.com` or a domain like `stripe.com`.
3. The app normalizes the input into a canonical hostname plus a fetchable URL.
4. The server performs a synchronous scan.
5. The UI immediately renders one of:
   - loading state
   - successful detections
   - no detections
   - invalid input error
   - scan failure error

### Input Rules

- Accept both domain-only and full URL input.
- Normalize to:
  - `normalizedUrl`
  - `canonicalHostname`
  - original raw input for display or debugging if needed
- Prefer HTTPS first and fall back to HTTP when needed.
- Strip unsupported fragments and normalize obvious formatting noise.

## Architecture

The implementation should use a thin API route plus dedicated service modules.

### Route

File:
- `app/api/tech-stack/route.ts`

Responsibilities:
- parse and validate request input
- normalize domain or URL input
- invoke the scanner and evaluator
- shape the final JSON response
- return user-facing errors

### Scanner Layer

Files:
- `lib/tech-stack/scanner.ts`
- `lib/tech-stack/types.ts`

Responsibilities:
- orchestrate website analysis
- collect HTTP, HTML, probe, cookie, and DNS signals
- tolerate partial failures where possible
- return one normalized signal bundle to the rules engine

### Rules Layer

Files:
- `lib/tech-stack/rules.ts`
- `lib/tech-stack/evaluator.ts`

Responsibilities:
- define code-based seed rules
- apply matcher logic against normalized signals
- collect evidence
- deduplicate repeated detections
- keep the highest-confidence result per technology and merge evidence

## Scanner Design

The scanner runs three phases.

### Phase 1: Primary HTTP Fetch

Fetch the main website document and capture:

- final URL after redirects
- status code
- response headers
- cookies
- full HTML body
- all `script src` URLs
- inline script content
- all `link href` values
- relevant `meta` tags
- security headers such as:
  - `content-security-policy`
  - `strict-transport-security`
  - `x-frame-options`
  - `x-content-type-options`
  - `referrer-policy`

The scanner should parse the HTML and extract reusable normalized arrays and maps instead of forcing rules to read raw DOM structures.

### Phase 2: Smart Probe Fetches

The first release should use a limited probe set rather than broad crawling.

Recommended probe targets:

- `/robots.txt`
- `/favicon.ico`
- `/.well-known/security.txt`
- `/.well-known/assetlinks.json`
- `/.well-known/apple-app-site-association`

Probe goals:

- identify additional headers or hosting fingerprints
- catch framework or platform patterns not visible on the homepage
- collect small, high-signal artifacts without turning this into a crawler

Probe failures must not fail the whole scan.

### Phase 3: DNS Resolution

Collect DNS signals for the canonical hostname:

- NS
- MX
- TXT
- CNAME

DNS goals:

- detect CDN and WAF vendors
- infer mail and security providers
- identify hosting or managed DNS patterns

Partial DNS failure must not fail the scan if other signals were collected successfully.

## Signal Model

The scanner should return a normalized bundle shaped around lookup evidence, not transport details.

Suggested structure:

```ts
type TechStackScanSignals = {
  input: {
    rawInput: string;
    normalizedUrl: string;
    canonicalHostname: string;
    finalUrl?: string;
  };
  http: {
    status?: number;
    headers: Record<string, string>;
    cookies: string[];
    html: string;
    scriptSrcs: string[];
    inlineScripts: string[];
    linkHrefs: string[];
    meta: Record<string, string>;
  };
  probes: Record<
    string,
    {
      ok: boolean;
      status?: number;
      headers?: Record<string, string>;
      body?: string;
    }
  >;
  dns: {
    ns: string[];
    mx: string[];
    txt: string[];
    cname: string[];
  };
  security: {
    csp: boolean;
    hsts: boolean;
    xFrameOptions: boolean;
    xContentTypeOptions: boolean;
    referrerPolicy: boolean;
  };
};
```

The exact TypeScript shape can change during implementation, but the separation of input, HTTP, probes, DNS, and derived security signals should remain.

## Detection Rules

Rules live in TypeScript for the first version.

File:
- `lib/tech-stack/rules.ts`

Each rule should define:

```ts
type TechDetectionRule = {
  id: string;
  technology: string;
  category: TechCategory;
  confidence: "high" | "medium" | "low";
  matcher: TechMatcher;
};
```

### Categories

First release categories:

- `Frontend / UI`
- `Framework / Runtime`
- `Analytics / Tag Manager`
- `Payments / Widgets`
- `CDN / WAF`
- `Hosting / Cloud`
- `DNS / Mail / Security`
- `CMS / Metadata`

### Matcher Types

The evaluator should support these matcher families:

- `header-contains`
- `script-src-regex`
- `link-href-regex`
- `html-regex`
- `cookie-name`
- `meta-generator-contains`
- `dns-pattern`
- `security-header-present`
- `combined`

The `combined` matcher should support simple AND logic across other matcher types so we can increase confidence for technologies like Cloudflare.

## Detection Output

The route should return richer records than the DNS tabs.

Suggested result shape:

```ts
type TechDetectionResult = {
  id: string;
  technology: string;
  category: TechCategory;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  source?: "header" | "script" | "link" | "html" | "cookie" | "meta" | "dns" | "security";
};
```

### Deduplication

Deduplicate by `technology`.

When more than one rule detects the same technology:

- keep the highest-confidence result
- merge evidence lines
- preserve useful source hints if available

This keeps the UI focused and avoids repeated entries like multiple `React` rows from overlapping signals.

## Seed Rule Strategy

Start with roughly 30 curated rules and bias toward precision over breadth.

Initial technologies to prioritize:

- Next.js
- React
- Vue
- Angular
- WordPress
- Shopify
- Webflow
- Google Tag Manager
- Google Analytics
- Stripe
- Cloudflare
- Vercel
- Netlify
- AWS
- HubSpot

Example rule directions:

- `Next.js`
  - header contains `next.js`
  - or high-signal framework patterns in HTML or assets
- `Cloudflare`
  - server header contains `cloudflare`
  - combined with NS record matching Cloudflare for high confidence
- `Google Tag Manager`
  - script source matches `googletagmanager.com`
- `Stripe`
  - script source contains `js.stripe.com`
- `WordPress`
  - meta generator contains `wordpress`
  - or HTML or assets indicate `wp-content`

## UI Design

### Sidebar

Add `Tech Stack` to:
- `components/ui/sidebar-component.tsx`

The sidebar item should behave exactly like the existing lookup tabs.

### Lookup Shell

Update:
- `components/dashboard-shell.tsx`

Add a new tab mode with:

- tech-stack-specific label and placeholder
- validation for domain-or-URL input
- endpoint target of `/api/tech-stack`
- tab-specific loading and empty-state copy

### Results Presentation

For the `Tech Stack` tab only, replace the simple DNS-style host table with a richer detection table.

Desktop columns:

- `Technology`
- `Category`
- `Confidence`
- `Evidence`

Mobile cards:

- technology as the primary line
- category and confidence as metadata
- one or more evidence lines beneath

### Result Content Rules

- confidence should display as `High`, `Medium`, or `Low`
- evidence must be human-readable
- avoid raw matcher objects in the UI
- show strongest evidence first when multiple evidence lines exist

Example evidence:

- `Meta generator matched WordPress`
- `Script source matched googletagmanager.com`
- `NS record matched cloudflare`

## Empty, Error, and Partial Result States

### Empty State

If no technologies are confidently detected:

- title: `No technologies detected`
- message: `We couldn't confidently identify supported technologies from the current website signals.`

### Invalid Input

If the target is not a valid domain or URL:

- show a clear inline validation message

### Scan Failure

If the website cannot be fetched:

- show a useful scan failure message

### Partial Failure

If DNS or some probes fail but the homepage fetch succeeds:

- still return detections from collected signals
- do not fail the whole scan

## Testing Plan

### Unit Tests

Add focused tests for:

- domain versus URL normalization
- homepage signal extraction
- smart probe handling
- DNS collection handling
- each matcher family
- deduplication logic
- confidence precedence
- merged evidence behavior

### API Route Tests

Add tests for:

- invalid target returns `400`
- successful scan returns categorized detections
- upstream fetch failure returns a useful error
- partial DNS failure still returns HTTP-derived detections

### UI Tests

Add tests for:

- sidebar shows `Tech Stack`
- switching to the tab updates the search copy
- form submits to `/api/tech-stack`
- loading state appears
- successful detections render
- no-results state renders
- evidence text is visible
- mobile layout mirrors desktop results

## Implementation Sequence

1. Add shared tech-stack types and normalization helpers.
2. Build the scanner service for homepage, probes, and DNS.
3. Add seed rules and the evaluator.
4. Add `/api/tech-stack` route.
5. Add the sidebar tab and dashboard integration.
6. Add tests and final UI polish.

## Risks And Guardrails

- Many sites intentionally hide signatures, so empty results are valid and should be handled honestly.
- Some technologies can only be inferred weakly; v1 should favor precision over broad guessing.
- DNS access and remote fetch behavior can vary by environment, so the scanner must degrade gracefully.
- The route should avoid turning into a crawler or long-running scan in this first release.

## Open Follow-Up Items For Future Versions

- async job processing
- saved scan history
- broader crawling across additional site paths
- externally editable rule definitions
- stronger scoring models across multiple weak signals
- richer categories and vendor coverage
