# Bulk ClickHouse Schema

The bulk pipeline now splits ClickHouse ownership between raw import landing
tables and serving/runtime tables so import, transform, and cutover can evolve
independently.

## Assets

- `clickhouse-raw.sql`: raw vendor landing table and import attempt metadata.
- `clickhouse-serving.sql`: transform attempt metadata, canonical serving
  tables, query-oriented mirrors, and active runtime state views.

## Schema Boundaries

- `clickhouse-raw.sql` owns the raw vendor landing table and import attempt
  metadata.
- `clickhouse-serving.sql` owns transform attempt metadata, serving tables, and
  active runtime state.
- The durable handoff is now raw ClickHouse rows, not `staging.parquet`.

## Serving Layout

The canonical table is `bulk_hostname_serving`. It keeps the required serving
columns plus `load_version` so rebuilt snapshots can be staged side by side.

Supporting query paths are materialized from that canonical table:

- `bulk_reverse_ip_serving`: ordered for reverse-IP lookups.
- `bulk_subdomain_serving`: ordered for apex-domain and first-label scans.
- `bulk_active_hostname_serving`
- `bulk_active_reverse_ip_serving`
- `bulk_active_subdomain_serving`

The `bulk_active_*` views only expose rows for the currently active
`load_version`. The active version is derived from `bulk_runtime_state_events`
through the `bulk_runtime_state_current` view.

## Cutover Model

Import and transform are append-only and versioned:

1. The import runtime lands source rows in `bulk_hostname_raw` and records
   source metadata in `bulk_import_attempt_events`.
2. The transform runtime reads raw ClickHouse rows, writes serving rows, and
   records transform readiness in `bulk_transform_attempt_events`.
3. The active serving state flips only after the new `load_version` is marked
   `ready`.

If the rebuild fails before readiness, the prior active version remains
unchanged.

## Operational Notes

- The raw/import boundary lives inside ClickHouse, so downstream transforms no
  longer depend on a durable `staging.parquet` handoff.
- Connection settings come from the existing bulk ClickHouse env vars:
  `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_DATABASE`,
  `CLICKHOUSE_USER`, and `CLICKHOUSE_PASSWORD`.
