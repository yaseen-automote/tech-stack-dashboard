# ClickHouse Direct Bulk Pipeline Design

Date: 2026-05-15
Status: Approved design, pending implementation plan

## Summary

Replace the current DuckDB-based monthly bulk ingest pipeline with a
ClickHouse-native two-phase pipeline that imports the vendor Parquet snapshot
directly into raw ClickHouse tables and then transforms those rows into the
serving tables already used by the Hono API and Next.js proxy routes.

The live application must keep serving the current active snapshot until a new
snapshot has completed both the raw import and the serving transform
successfully. Polars should be added as a post-load utility layer for cleanup,
reporting, enrichment, and export workflows, but it must not be part of the
critical path for monthly activation.

## Goals

- Remove DuckDB from the monthly bulk ingest path.
- Import the vendor Parquet snapshot directly into ClickHouse.
- Preserve the current active-snapshot cutover safety model.
- Keep the existing API response contracts for reverse DNS, subdomains, and
  CNAMEs.
- Add a dedicated Polars workspace for post-load cleanup and analysis work.
- Make the April 2026 snapshot load operationally feasible on the deployed
  single-host server.

## Non-Goals

- No streaming or one-shot direct transformation from Parquet into the final
  serving tables.
- No cutover to partially transformed data.
- No requirement for Polars to succeed before a snapshot can become active.
- No frontend contract changes for the dashboard lookup tabs beyond optional
  non-breaking metadata.
- No reintroduction of large Node-side row-by-row normalization logic.

## Current Problems

- The current `bulk/ingest/` workspace uses DuckDB to read Parquet, normalize
  data, and publish `staging.parquet`.
- The April 2026 snapshot is approximately 70 GB extracted, which makes the
  existing ingest path operationally fragile and unnecessarily complex.
- The current staging handoff introduces an extra durable artifact that is not
  needed if ClickHouse can own both raw durability and serving transforms.
- Polars is not currently part of the workflow, even though it is a better fit
  for optional follow-up cleanup analysis than DuckDB is for critical-path
  ingest.

## Architecture

The new bulk pipeline should use four focused responsibilities.

### 1. Raw Import Workspace

New workspace:
- `bulk/import/`

Responsibilities:
- read the monthly manifest
- verify source file existence
- verify `sizeBytes` and optional checksum when present
- register an import attempt in ClickHouse metadata tables
- import vendor Parquet directly into ClickHouse raw tables for the target
  `snapshot_month`

The raw import step should perform only minimal normalization needed to ingest
data safely. It should preserve source-oriented fields so that later transforms
and cleanup jobs can inspect the original values.

### 2. Serving Transform Workspace

New workspace:
- `bulk/transform/`

Responsibilities:
- transform raw ClickHouse rows into serving tables using ClickHouse SQL
- derive query-facing fields such as:
  - `hostname`
  - `ip_address`
  - `apex_domain`
  - `tld`
  - `first_label`
  - `cname_target`
  - `provider_hint`
- record transform/load attempt metadata and row counts
- activate the new `load_version` only after the transform completes

The transform step replaces the current dependency on `staging.parquet`. The
new durable boundary is raw ClickHouse data followed by transformed ClickHouse
serving data.

### 3. Serving API Workspace

Existing workspace:
- `bulk/api/`

Responsibilities:
- continue querying active serving views in ClickHouse
- preserve existing Hono endpoint behavior:
  - `GET /health`
  - `GET /v1/reverse-ip`
  - `GET /v1/subdomains`
  - `GET /v1/cnames`
  - `GET /v1/infrastructure/summary`

The bulk API should not need major contract changes because the serving-table
shape stays consistent.

### 4. Polars Utility Workspace

New workspace:
- `bulk/polars/`

Responsibilities:
- run after import and transform complete successfully
- generate cleanup and anomaly reports
- support dedupe analysis and optional enrichment workflows
- produce exports or repair candidates if needed

Polars is explicitly post-load and non-critical. A Polars failure must not
prevent a snapshot from becoming active.

## Data Model

### Raw ClickHouse Tables

ClickHouse should gain raw tables that represent the vendor snapshot with
minimal assumptions.

Expected characteristics:
- store `snapshot_month`
- store source columns with permissive nullable types
- track import version or import attempt metadata
- retain enough raw fields to diagnose malformed or ambiguous rows later

The raw schema may include canonical columns inferred from candidate source
column names, but it should not depend on a precomputed `staging.parquet`
artifact.

### Serving ClickHouse Tables

The current serving tables remain the public query boundary:
- `bulk_hostname_serving`
- `bulk_reverse_ip_serving`
- `bulk_subdomain_serving`
- active views backed by `bulk_runtime_state_current`

The transform step should continue populating these tables by `load_version`,
so existing active-snapshot switching semantics remain intact.

### Metadata and Event Tables

ClickHouse metadata should distinguish:
- raw import attempt events
- transform/load attempt events
- runtime active-state events

The system should be able to answer:
- which snapshot month was imported
- which source file or checksum produced a given import
- whether a raw import failed or succeeded
- whether a transform failed or succeeded
- which `load_version` is currently active

## Operational Flow

### Monthly Import and Activation

1. Download the vendor Parquet snapshot.
2. Create or update the monthly manifest.
3. Run the raw ClickHouse import for the target `snapshot_month`.
4. Run the ClickHouse serving transform for the imported snapshot.
5. If the transform succeeds, activate the new `load_version`.
6. Optionally run Polars cleanup, anomaly, and enrichment jobs afterward.

### Safe Cutover

The live application must keep serving the current active snapshot until both
of these are true:
- raw import completed successfully
- serving transform completed successfully

Raw import success alone is not enough for cutover.

This preserves the current safety model and prevents the dashboard from serving
partially prepared data.

## Commands and Runtime Contracts

The old command model:
- `bulk:ingest`
- `bulk:load`

should be replaced with a ClickHouse-native model such as:
- `bulk:import`
- `bulk:transform`
- optional `bulk:polars:*`

The exact command names can vary during implementation, but the responsibilities
must be split this way:
- import owns manifest verification plus raw ClickHouse ingest
- transform owns serving-table population plus activation
- Polars commands own post-load reporting or cleanup only

## Error Handling

- If the source Parquet file is missing, import fails before any ClickHouse
  writes.
- If `sizeBytes` or checksum validation fails, import stops before raw ingest.
- If raw import fails mid-run, the import attempt is recorded as failed and the
  active serving snapshot remains unchanged.
- If the serving transform fails, the failed `load_version` is recorded, the
  raw imported data remains available for inspection, and the active serving
  snapshot remains unchanged.
- If Polars jobs fail, they do not affect active serving state because they are
  post-load only.

## Testing Strategy

### Import Tests

Replace DuckDB ingest coverage with direct ClickHouse import tests for:
- manifest validation
- source file existence checks
- size and checksum enforcement
- raw import event registration
- idempotent handling for repeated imports of the same source
- failure recording for import errors

### Transform and Cutover Tests

Retain and adapt ClickHouse load tests for:
- transform row counts
- serving-table population by `load_version`
- ready-load reuse behavior
- active snapshot switching
- transform failure recording without cutover

### API Contract Tests

Keep the existing route and Hono contract coverage so:
- `/api/subdomains`
- `/api/cnames`
- `/api/reverse-dns`

continue returning the same payload shapes consumed by the dashboard.

### Polars Tests

Add focused tests for:
- cleanup report generation
- anomaly detection on fixture data
- export formatting for optional downstream use

## Migration Plan

### Repo Migration

- replace or retire `bulk/ingest/`
- introduce `bulk/import/`
- introduce `bulk/transform/`
- introduce `bulk/polars/`
- update `package.json` scripts
- update deployment docs and operator runbooks
- remove the `@duckdb/node-api` dependency if nothing else requires it

### Server Migration

- keep the currently active sample snapshot live
- complete the new direct raw import for April 2026
- run the serving transform in ClickHouse
- activate April 2026 only after transform success
- run optional Polars cleanup tasks after activation or after transform, as
  needed

## Success Criteria

- DuckDB is no longer required for monthly bulk ingest.
- The system imports the vendor Parquet directly into ClickHouse raw tables.
- The serving API continues to answer reverse DNS, subdomain, and CNAME lookups
  without contract changes.
- Active cutover remains safe and explicit.
- Polars is available for post-load cleanup work without blocking activation.
- The April 2026 snapshot can be loaded and activated on the deployed host
  using the new pipeline.
