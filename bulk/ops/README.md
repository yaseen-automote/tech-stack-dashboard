# Bulk Ops Runbook

Operational assets for the single-host deployment live here.

The intended topology is:

- `dashboard` is the only public service.
- `bulk-api` and `clickhouse` stay private on the internal Compose network.
- Host operators reach private services with `docker compose exec ...` rather
  than published ports, container-only hostnames, or host-installed Node tools.

If your host provides the standalone `docker-compose` binary instead of the
Compose plugin, substitute `docker-compose` for `docker compose` in the command
examples below.

## Bootstrap

1. Sync the repo to the server, for example under `/opt/tech-stack-dashboard`.
2. Run the bootstrap script as root. By default it assigns `.env.bulk` and the
   snapshot root to the invoking sudo user via `SUDO_USER`; override
   `OPERATOR_USER` or `OPERATOR_GROUP` if your deployment operator is different:

```bash
sudo APP_ROOT=/opt/tech-stack-dashboard ./scripts/bootstrap-bulk-host.sh
```

3. Review `.env.bulk` and replace all bootstrap-only credentials before first launch.
4. If you intentionally leave `OPERATOR_USER` unset, use `sudo` for later host
   edits to `.env.bulk` and for placing refresh input files under
   `/var/lib/tech-stack-dashboard/bulk-snapshots/`.

## First Start

From the repo root on the server:

```bash
docker compose --env-file .env.bulk up -d --build
docker compose --env-file .env.bulk ps
```

Expected services:

- `dashboard`
- `bulk-api`
- `clickhouse`

## Monthly Refresh

1. Place the monthly source parquet on the host under
   `/var/lib/tech-stack-dashboard/bulk-snapshots/input/YYYY-MM/`.
2. Write a manifest JSON for the snapshot month in the same mounted input
   directory so the `bulk-api` container can read it.
3. Run the raw import inside the private Compose network:

```bash
docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:import -- --manifest /var/lib/tech-stack-dashboard/bulk-snapshots/input/YYYY-MM/monthly-manifest.json
```

4. Run the serving transform to populate ClickHouse serving tables and activate
   the new load version:

```bash
docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:transform -- --snapshot-month YYYY-MM --import-version <import-version> --source-key <source-key>
```

Capture the `import-version` and `source-key` from the import command output
before running the transform step.

5. Optionally run the Polars cleanup report after activation:

```bash
docker compose --env-file .env.bulk exec -T bulk-api python3 bulk/polars/src/report.py --input /tmp/export.csv --output /tmp/report.json
```

The import and transform steps run inside the `bulk-api` container so the bulk
tool chain does not depend on Node being installed on the host, and
`CLICKHOUSE_HOST=clickhouse` continues to work without exposing ClickHouse on
the host.

## Health Checks

Liveness checks confirm that the deployed processes respond at all:

```bash
docker compose --env-file .env.bulk exec -T bulk-api node -e "const port = process.env.HONO_PORT || '8787'; fetch('http://127.0.0.1:' + port + '/health').then(async (response) => { const body = await response.text(); if (!response.ok) { console.error(body); process.exit(1); } process.stdout.write(body); }).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });"
curl -f http://127.0.0.1:3000/ > /dev/null
docker compose --env-file .env.bulk ps
```

Functional smoke checks confirm query behavior after liveness is established:

```bash
curl -f "http://127.0.0.1:3000/api/subdomains?domain=example.com"
docker compose --env-file .env.bulk ps
docker compose --env-file .env.bulk logs bulk-api --tail 100
docker compose --env-file .env.bulk logs clickhouse --tail 100
```

The dashboard liveness check above only proves the public web app is serving
HTTP. The query smoke check exercises the bulk lookup path and may fail because
of data or downstream query issues even when `dashboard` itself is up. The bulk
API health check must stay in-container because `bulk-api` is intentionally not
published. If you are operating from a host that also has Node installed, the
`bulk:*:compose` npm scripts in `package.json` are optional convenience wrappers
around the same `docker compose` commands shown here.

## Rollback

- If a raw import fails, the previously active serving data is unchanged.
- If a serving transform fails before readiness, the previous active load
  remains active and the failed load version is recorded.
- To roll back application code, redeploy the prior container images while
  keeping the same ClickHouse volume.

## Restart Flow

```bash
docker compose --env-file .env.bulk restart bulk-api dashboard
docker compose --env-file .env.bulk restart clickhouse
```

Restart `clickhouse` only when necessary because it is the longest-lived
stateful component in the stack.

## Disk Budget

Plan disk for:

- raw monthly source parquet
- ClickHouse raw and serving data
- Docker image and layer storage

Keep at least one prior successful import and transform available during
refresh windows so rollback stays cheap.

## Rebuild Split Lookup Tables

If the split lookup tables (`bulk_apex_domain_lookup`,
`bulk_subdomain_lookup_v2`) become corrupted or out of sync with the active
serving load, you can truncate and repopulate them from the currently active
hostname serving data.

From the repo root on the server:

```bash
docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:rebuild-lookups
```

Or from a host with Node installed (development):

```bash
npm run bulk:rebuild-lookups
```

The command:

1. Ensures the ClickHouse schema exists (safe to run at any time).
2. Reads the active load version from `bulk_runtime_state_current`.
3. Truncates both split lookup tables.
4. Reads all hostnames from `bulk_hostname_serving` for the active load
   version.
5. Rebuilds the apex and subdomain lookup rows using the same split-and-dedupe
   logic as the serving transform.
6. Inserts the rebuilt rows into both lookup tables.
7. Logs the inserted row counts.
