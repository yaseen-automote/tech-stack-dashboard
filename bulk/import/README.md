# Bulk Import

This workspace owns the direct ClickHouse raw import step for monthly bulk
snapshot files. It reads a manifest, verifies the parquet source, streams raw
rows into `bulk_hostname_raw`, and records import readiness in
`bulk_import_attempt_events`.

## Manifest

The import command expects a JSON manifest with the snapshot month, snapshot ID,
and source parquet file:

```json
{
  "snapshotMonth": "2026-04",
  "snapshotId": "passive-dns-2026-04",
  "source": {
    "parquetPath": "C:/data/passive-dns-2026-04.parquet",
    "sizeBytes": 123456789,
    "checksum": {
      "algorithm": "sha256",
      "value": "abc123..."
    }
  }
}
```

`sizeBytes` and `checksum` are optional, but when provided they are enforced
before any ClickHouse import starts.

## Expected Source Shape

The raw parquet input is expected to provide these nullable columns:

- `hostname`
- `ip_address`
- `cname_target`
- `provider_hint`

The import step lands those values directly into `bulk_hostname_raw` with an
`import_version`, `snapshot_month`, and ClickHouse-generated
`source_row_number`.

## Command

```bash
npm run bulk:import -- --manifest ./path/to/monthly-manifest.json
```

Compose helper:

```bash
npm run bulk:import:compose -- --manifest ./path/to/monthly-manifest.json
```
