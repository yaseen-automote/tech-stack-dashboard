# CT Workspace

This workspace owns the step-2 Certificate Transparency monitoring pipeline.

- `schema/`: ClickHouse tables and active views for CT raw lines, watchlists,
  observations, and alert feeds.
- `fetch/`: source index parsing, daily dump download, and manifest generation.
- `import/`: manifest-driven gzip line import into ClickHouse raw tables.
- `transform/`: line parsing, normalization, conservative scoring, and active
  alert load cutover.
- `types.ts`: shared step-2 monitoring types.
