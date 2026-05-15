# Bulk Transform

This workspace owns the ClickHouse-to-ClickHouse serving transform step for
monthly bulk snapshots. It reads imported rows from `bulk_hostname_raw`,
projects them into the serving tables, records transform readiness in
`bulk_transform_attempt_events`, and only updates the active serving
`load_version` after a successful transform.

## Inputs

The transform command takes three required identifiers:

- `snapshotMonth`
- `importVersion`
- `sourceKey`

The `sourceKey` should match the ready import attempt so an already-ready
transform can be reused safely.

## Transform Behavior

The transform step:

- ensures the serving schema exists
- reuses a prior ready transform for the same `sourceKey` when available
- inserts normalized serving rows from `bulk_hostname_raw`
- marks the transform `failed` without changing active runtime state if the
  serving insert fails
- activates the new `load_version` only after the transform is marked `ready`

## Command

```bash
tsx bulk/transform/src/cli.ts --snapshot-month 2026-04 --import-version import-2026-04 --source-key 2026-04:abc
```

When run through npm after Task 4 adds the script:

```bash
npm run bulk:transform -- --snapshot-month 2026-04 --import-version import-2026-04 --source-key 2026-04:abc
```
