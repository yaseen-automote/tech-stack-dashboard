# Polars Post-Load Reporting

Post-load cleanup and anomaly reporting workspace using Python Polars.

This workspace runs after a ClickHouse import and transform have completed
successfully. It is explicitly non-critical: a Polars failure must not prevent
a snapshot from becoming active.

## Usage

```bash
python3 bulk/polars/src/report.py --input /path/to/export.csv --output /path/to/report.json
```

Or inside Docker Compose:

```bash
docker compose --env-file .env.bulk exec -T bulk-api python3 bulk/polars/src/report.py --input /tmp/export.csv --output /tmp/report.json
```

## Report Output

The report JSON contains:

- `totalRows`: total number of rows in the input CSV
- `duplicateHostnames`: count of rows where the hostname appears more than once
- `emptyIpRows`: count of rows where `ip_address` is null or empty