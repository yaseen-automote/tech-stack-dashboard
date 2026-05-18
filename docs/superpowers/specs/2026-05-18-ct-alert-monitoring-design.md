# CT Alert Monitoring Design

Date: 2026-05-18
Status: Approved design

## Summary

Add an alert-first Certificate Transparency monitoring subsystem alongside the
existing step-1 recon engine. The first release should ingest daily CT dumps
from `https://cs2.ip.thc.org/`, normalize certificate-domain observations into
ClickHouse, match them conservatively against structured watchlists, and expose
the results as a dense dashboard feed.

This release is intentionally additive. It must not replace or weaken the
current subdomain, reverse-DNS, CNAME, or tech-stack workflows. Step 1 remains
the default recon engine; step 2 introduces a parallel monitoring engine.

## Confirmed Source

On 2026-05-18, `https://cs2.ip.thc.org/` exposed a dated directory listing of
daily `.txt.gz` files, for example `2025-11-24.txt.gz`, with compressed sizes
roughly in the 220 MB to 540 MB range. That makes the source suitable for a
daily batch-ingest workflow.

Two source-handling assumptions shape this design:

1. The upstream dump naming convention is stable enough to batch by date.
2. The exact line format may evolve or differ between datasets, so parsing must
   be isolated behind a resilient adapter rather than hard-coded across the app.

## Goals

- Ingest daily CT batch files from `cs2.ip.thc.org`.
- Preserve the existing step-1 ClickHouse recon engine and UI unchanged.
- Support three first-release alert categories:
  - phishing detection
  - brand protection
  - shadow IT detection
- Use conservative matching to minimize noise in the first release.
- Deliver alerts in a dense dashboard feed only.
- Keep the system fully reversible by making schema, API, and UI additions
  separate from the current bulk lookup flow.

## Non-Goals

- No Slack, webhook, or email delivery in the first release.
- No near-real-time polling or streaming ingestion.
- No attempt to warehouse the full long-term CT universe before alerts ship.
- No requirement to enrich every alert with step-1 infrastructure context in
  release one.
- No destructive schema changes to the current `bulk_*` tables or routes.

## Product Shape

The first release adds a new dashboard tab, likely `CT Monitor` or `Alerts`.
Unlike the current search-first tabs, this tab opens directly into a dense feed.

The top of the view should provide summary counters for:

- new alerts today
- high-severity alerts
- phishing alerts
- brand-protection alerts
- shadow-IT alerts

The main content is a compact review table with columns such as:

- observed date
- domain
- category
- severity
- matched term
- reasons

Selecting a row should reveal a details panel containing:

- normalized matched domain
- source dump date
- all matching reasons
- watchlist type
- raw source line reference
- optional issuer / timing metadata when the parser can extract it

## Architecture

Step 2 should use five focused responsibilities.

### 1. CT Fetch Workspace

New workspace:
- `ct/fetch/`

Responsibilities:
- inspect the upstream CT source index
- resolve a target daily dump by date
- download the `.txt.gz` file into local snapshot storage
- compute `sizeBytes` and `sha256`
- write a manifest describing the downloaded file

This keeps network volatility away from the critical ingest logic and matches
the existing step-1 manifest-driven pattern.

### 2. CT Raw Import Workspace

New workspace:
- `ct/import/`

Responsibilities:
- read the CT manifest
- verify source file existence, size, and checksum
- stream the compressed dump into ClickHouse raw tables
- record import attempt metadata

The raw import step should not assume a fully stable upstream schema. It should
preserve the original line text and attach dump-level metadata such as
`dump_date`, `source_url`, `source_sha256`, and `line_number`.

### 3. CT Transform and Matching Workspace

New workspace:
- `ct/transform/`

Responsibilities:
- parse raw CT lines into candidate hostname observations
- normalize hostnames and optional certificate metadata
- expand one raw line into one or more domain observations when needed
- score observations against watchlists
- materialize alert candidates and the active alert feed

This workspace replaces brittle one-off parsing logic with a single
transformation boundary inside ClickHouse-backed application code.

### 4. CT API Workspace

Implementation location:
- extend the existing `bulk/api/` service for the first release

Responsibilities:
- serve the dense alert feed
- serve alert summary counters
- manage watchlist entries

Using the existing backend keeps deployment simple and rollback easy. If step 2
later grows into an independent service, the API surface can be split then.

### 5. Dashboard Workspace

Existing workspace:
- `components/dashboard-shell.tsx`
- `app/api/*`

Responsibilities:
- add a new monitoring tab
- fetch and render alert summary + feed data
- expose basic watchlist management or a compact watchlist editor

## Data Model

### Raw CT Tables

The first release should add raw ClickHouse tables for line-oriented ingestion.

Recommended tables:

- `ct_log_line_raw`
  - `import_version`
  - `dump_date`
  - `source_line_number`
  - `raw_line`
  - `source_url`
  - `source_sha256`
  - `imported_at`

- `ct_import_attempt_events`
  - import metadata, source file identity, row counts, and status

This model is intentionally line-preserving. Even if the upstream line format
changes, the original text remains available for diagnosis and reprocessing.

### Serving and Alert Tables

Recommended serving tables:

- `ct_domain_observation`
  - one normalized candidate domain per parsed observation
- `ct_alert_candidate`
  - one scored match candidate per observation/watchlist comparison
- `ct_alert_feed`
  - final alert rows that the dashboard reads

Recommended fields on `ct_domain_observation`:

- `load_version`
- `dump_date`
- `observed_domain`
- `registrable_domain`
- `first_label`
- `issuer_name` nullable
- `not_before` nullable
- `not_after` nullable
- `raw_line_hash`

Recommended fields on `ct_alert_feed`:

- `load_version`
- `alert_id`
- `dump_date`
- `domain`
- `category`
- `severity`
- `watch_type`
- `matched_term`
- `reasons`
- `issuer_name` nullable
- `first_seen_at` nullable
- `created_at`

### Watchlist Tables

Use one normalized watchlist table instead of three separate schemas.

Recommended table:
- `ct_watchlist_entry`

Fields:
- `entry_id`
- `watch_type` (`brand`, `internal`, `keyword`)
- `term`
- `enabled`
- `created_at`
- `updated_at`

This keeps the data model simple while still preserving the separate watchlist
types the product needs.

## Parsing Strategy

Because the upstream daily dumps may not guarantee a single documented schema,
the transform layer should use a parser adapter with this priority order:

1. If a raw line looks like JSON, parse it and extract hostnames from known
   fields such as:
   - `name_value`
   - `common_name`
   - `dns_names`
   - `subject_alt_names`
   - `all_domains`

2. If a raw line contains tab-separated fields, inspect each field and extract
   any hostname-like tokens.

3. Otherwise, treat the whole trimmed line as a plain domain observation if it
   matches the hostname validator.

The parser should always preserve `raw_line` and should never block import just
because a line could not be normalized into a hostname observation.

## Matching Strategy

The first release uses conservative matching only.

### Phishing

Create a phishing alert when:

- a domain contains a watched brand term and at least one high-risk keyword
  such as `login`, `secure`, `auth`, `verify`, `update`, or `support`
- or a domain is a close lookalike of a watched brand term and also contains a
  high-risk keyword

### Brand Protection

Create a brand-protection alert when:

- a domain contains a watched brand or product term
- and the match is not clearly one of the organization’s own approved domains

### Shadow IT

Create a shadow-IT alert when:

- a domain contains a watched internal identifier
- or a domain combines infrastructure-like terms such as `vpn`, `grafana`,
  `jenkins`, `kibana`, `admin`, `api`, `staging`, or `internal`
- and the match appears in newly observed CT data

### Severity

Recommended first-release severity rules:

- `high`
  - brand term + risky keyword
  - internal identifier + infrastructure keyword
  - obvious lookalike + risky keyword
- `medium`
  - direct brand term match without risky keyword
  - internal identifier alone
- `low`
  - reserved for future expansion; do not flood the first release with low
    severity noise

## API Shape

Recommended new backend routes:

- `GET /v1/ct/alerts`
- `GET /v1/ct/alerts/summary`
- `GET /v1/ct/watchlists`
- `POST /v1/ct/watchlists`
- `PATCH /v1/ct/watchlists/:entryId`
- `DELETE /v1/ct/watchlists/:entryId`

Recommended browser proxy routes:

- `/api/alerts`
- `/api/alerts/summary`
- `/api/watchlists`

The alert feed should support:

- date filtering
- category filtering
- severity filtering
- simple pagination

## Operational Flow

### Daily Batch Flow

1. Resolve the target CT dump date.
2. Download the source `.txt.gz` from `cs2.ip.thc.org`.
3. Write a local manifest with source path, size, checksum, and dump date.
4. Import raw lines into ClickHouse.
5. Transform raw lines into normalized domain observations.
6. Score and materialize alert rows.
7. Mark the new CT `load_version` active only after transform success.
8. Expose the new alert feed to the dashboard.

### Safe Rollout

The CT monitoring subsystem should have its own `load_version` and active-state
tracking. A failed CT import or transform must not affect the existing step-1
passive-DNS snapshot or its serving routes.

## Rollback Plan

Rollback must be trivial:

- disable the dashboard `CT Monitor` tab
- disable the CT API routes or route registration
- stop the CT fetch/import schedule
- leave the step-1 `bulk_*` data and API untouched

No step-2 failure should require reverting the current subdomain, reverse-DNS,
or CNAME features.

## Testing Strategy

### Fetch Tests

- source index parsing
- target date resolution
- download retry and checksum verification
- manifest writing

### Import Tests

- manifest validation
- gz line streaming into raw ClickHouse rows
- import attempt status recording

### Transform Tests

- JSON-line parsing
- TSV-line parsing
- plain-domain parsing
- invalid-line preservation without alert generation
- conservative category/severity assignment
- active CT load switching

### API Tests

- alert feed response shape
- summary response shape
- watchlist CRUD behavior
- dashboard proxy error handling

### UI Tests

- new alerts tab rendering
- summary counters
- dense table rendering
- filter state
- watchlist editing interactions if included in release one

## Success Criteria

- The app can ingest daily CT dumps from `cs2.ip.thc.org` through a manifest
  driven batch flow.
- Raw CT lines and normalized domain observations are stored in ClickHouse.
- Conservative alerts are generated for phishing, brand protection, and shadow
  IT scenarios.
- The dashboard exposes a dense alert feed without disturbing step 1.
- The subsystem can be disabled or rolled back without affecting the current
  recon engine.
