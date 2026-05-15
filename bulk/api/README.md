# Bulk API

The bulk API runs as a separate Hono service behind the dashboard on the private
Compose network. It is the service boundary between the Next.js dashboard and
the ClickHouse-backed bulk serving dataset.

In the single-host deployment, this service is intentionally not exposed on a
host port. Check it from the host with
`docker compose --env-file .env.bulk exec -T bulk-api node -e ".../health..."` or
the `npm run bulk:health:compose` wrapper.

## Endpoints

- `GET /health`
- `GET /v1/reverse-ip?ip=...&limit=...`
- `GET /v1/subdomains?domain=...&limit=...`
- `GET /v1/cnames?domain=...&limit=...`
- `GET /v1/infrastructure/summary?domain=...`

## Data Sources

- `reverse-ip`, `subdomains`, and `infrastructure/summary` read from the active
  ClickHouse serving views.
- `cnames` uses active bulk `cname_target` data when available and falls back to
  `ip.thc.org` when the active dataset cannot support that lookup cleanly.

## Contract Notes

- Lookup endpoints preserve the dashboard-oriented `{ domain, results }` shape.
- Optional metadata such as `snapshotMonth` and `source` may be present.
- The service-layer route is `reverse-ip`, even though the current Next.js app
  still exposes `/api/reverse-dns` to the browser.
