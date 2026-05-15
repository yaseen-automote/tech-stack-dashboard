# Bulk Workspace

This workspace isolates the single-host bulk data stack from the existing dashboard
feature code until later tasks wire in ingest and query behavior.

- `api/`: Hono service scaffold and container assets.
- `import/`: ClickHouse raw import from vendor Parquet snapshots.
- `transform/`: ClickHouse serving transform and safe cutover.
- `polars/`: Post-load cleanup and anomaly reporting (Python).
- `schema/`: ClickHouse raw, serving, and runtime DDL.
- `ops/`: deployment notes and host-facing operational helpers.
