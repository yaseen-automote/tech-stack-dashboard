# ClickHouse Direct Bulk Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DuckDB monthly ingest pipeline with a ClickHouse-native raw import plus serving transform pipeline, then add Polars as a post-load cleanup/reporting layer without changing the dashboard lookup contracts.

**Architecture:** The new flow lands vendor Parquet directly into ClickHouse raw tables, transforms raw rows into versioned serving tables with ClickHouse SQL, and activates a snapshot only after transform success. Polars becomes a separate post-load utility workspace for cleanup and anomaly reporting rather than part of the activation path.

**Tech Stack:** Node.js, TypeScript, ClickHouse, Hono, Next.js, Python 3, Polars, Docker Compose, Vitest

---

## File Structure

### New files

- `bulk/import/README.md`
- `bulk/import/import.test.ts`
- `bulk/import/src/cli.ts`
- `bulk/import/src/config.ts`
- `bulk/import/src/importer.ts`
- `bulk/import/src/manifest.ts`
- `bulk/import/src/repository.ts`
- `bulk/import/src/types.ts`
- `bulk/transform/README.md`
- `bulk/transform/transform.test.ts`
- `bulk/transform/src/cli.ts`
- `bulk/transform/src/config.ts`
- `bulk/transform/src/transformer.ts`
- `bulk/transform/src/repository.ts`
- `bulk/transform/src/types.ts`
- `bulk/polars/README.md`
- `bulk/polars/requirements.txt`
- `bulk/polars/report.test.ts`
- `bulk/polars/src/report.py`
- `bulk/schema/clickhouse-raw.sql`

### Modified files

- `package.json`
- `package-lock.json`
- `bulk/README.md`
- `bulk/schema/clickhouse-serving.sql`
- `bulk/schema/README.md`
- `bulk/api/src/repository.test.ts`
- `bulk/api/src/repository.ts`
- `bulk/ops/README.md`
- `bulk/api/Dockerfile`
- `docker-compose.yml`
- `.env.example`

### Retired or reduced files

- `bulk/ingest/README.md`
- `bulk/ingest/pipeline.test.ts`
- `bulk/ingest/publish-output.test.ts`
- `bulk/ingest/src/cli.ts`
- `bulk/ingest/src/manifest.ts`
- `bulk/ingest/src/normalize.ts`
- `bulk/ingest/src/pipeline.ts`
- `bulk/ingest/src/types.ts`
- `bulk/load/config.test.ts`
- `bulk/load/loader.test.ts`
- `bulk/load/repository.test.ts`
- `bulk/load/src/cli.ts`
- `bulk/load/src/config.ts`
- `bulk/load/src/loader.ts`
- `bulk/load/src/repository.ts`
- `bulk/load/src/types.ts`

The implementation may delete retired files once replacement coverage is in place.

### Task 1: Replace the schema with raw import and transform-aware ClickHouse tables

**Files:**
- Create: `bulk/schema/clickhouse-raw.sql`
- Modify: `bulk/schema/clickhouse-serving.sql`
- Modify: `bulk/schema/README.md`
- Test: `bulk/api/src/repository.test.ts`

- [ ] **Step 1: Write the failing repository tests for the new raw/active views**

```ts
it("reads reverse-ip rows from the active serving view after runtime cutover", async () => {
  await repository.ensureSchema();

  await client.exec({
    query: `
      INSERT INTO bulk_hostname_serving
      (
        load_version,
        snapshot_month,
        ip_address,
        hostname,
        apex_domain,
        tld,
        first_label,
        cname_target,
        provider_hint
      )
      FORMAT JSONEachRow
    `,
    values: [
      {
        load_version: "load-2026-04",
        snapshot_month: "2026-04",
        ip_address: "203.0.113.10",
        hostname: "api.example.com",
        apex_domain: "example.com",
        tld: "com",
        first_label: "api",
        cname_target: "edge.example.net",
        provider_hint: "cloudflare",
      },
    ],
  });

  await client.command({
    query: `
      INSERT INTO bulk_runtime_state_events
      (state_key, load_version, snapshot_month, recorded_at)
      VALUES ('hostname_serving', 'load-2026-04', '2026-04', now64(3))
    `,
  });

  const rows = await repository.lookupReverseIp({ ip: "203.0.113.10", limit: 10 });

  expect(rows).toEqual([
    {
      hostname: "api.example.com",
      snapshotMonth: "2026-04",
    },
  ]);
});
```

- [ ] **Step 2: Run the repository test to verify the current schema is incomplete**

Run: `npm test -- bulk/api/src/repository.test.ts`
Expected: FAIL because the schema does not yet define the raw import metadata or revised serving cutover path.

- [ ] **Step 3: Add raw import and metadata DDL**

```sql
CREATE TABLE IF NOT EXISTS bulk_hostname_raw
(
  import_version String,
  snapshot_month LowCardinality(String),
  source_row_number UInt64,
  raw_hostname Nullable(String),
  raw_ip_address Nullable(String),
  raw_cname_target Nullable(String),
  raw_provider_hint Nullable(String),
  imported_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY snapshot_month
ORDER BY (snapshot_month, import_version, source_row_number);

CREATE TABLE IF NOT EXISTS bulk_import_attempt_events
(
  import_version String,
  source_key String,
  snapshot_month LowCardinality(String),
  source_parquet_path String,
  source_file_bytes UInt64,
  source_file_sha256 FixedString(64),
  status Enum8('importing' = 1, 'ready' = 2, 'failed' = 3),
  row_count UInt64 DEFAULT 0,
  error_message Nullable(String),
  recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (source_key, import_version, recorded_at);
```

- [ ] **Step 4: Update the serving schema to separate import and transform events**

```sql
CREATE TABLE IF NOT EXISTS bulk_transform_attempt_events
(
  load_version String,
  import_version String,
  source_key String,
  snapshot_month LowCardinality(String),
  status Enum8('transforming' = 1, 'ready' = 2, 'failed' = 3),
  row_count UInt64 DEFAULT 0,
  error_message Nullable(String),
  recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (source_key, load_version, recorded_at);

CREATE VIEW IF NOT EXISTS bulk_transform_attempts_latest AS
SELECT
  load_version,
  source_key,
  argMax(import_version, recorded_at) AS import_version,
  argMax(snapshot_month, recorded_at) AS snapshot_month,
  argMax(status, recorded_at) AS status,
  argMax(row_count, recorded_at) AS row_count,
  argMax(error_message, recorded_at) AS error_message,
  max(recorded_at) AS latest_recorded_at
FROM bulk_transform_attempt_events
GROUP BY load_version, source_key;
```

- [ ] **Step 5: Document the new schema boundaries**

```md
- `clickhouse-raw.sql` owns the raw vendor landing table and import attempt metadata.
- `clickhouse-serving.sql` owns transform attempt metadata, serving tables, and active runtime state.
- The durable handoff is now raw ClickHouse rows, not `staging.parquet`.
```

- [ ] **Step 6: Run the schema-sensitive tests**

Run: `npm test -- bulk/api/src/repository.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add bulk/schema/clickhouse-raw.sql bulk/schema/clickhouse-serving.sql bulk/schema/README.md bulk/api/src/repository.test.ts
git commit -m "feat: add clickhouse raw and transform schema"
```

### Task 2: Build the direct ClickHouse raw import workspace

**Files:**
- Create: `bulk/import/src/types.ts`
- Create: `bulk/import/src/manifest.ts`
- Create: `bulk/import/src/config.ts`
- Create: `bulk/import/src/repository.ts`
- Create: `bulk/import/src/importer.ts`
- Create: `bulk/import/src/cli.ts`
- Create: `bulk/import/import.test.ts`
- Create: `bulk/import/README.md`
- Modify: `package.json`
- Test: `bulk/import/import.test.ts`

- [ ] **Step 1: Write failing import tests for manifest validation and import event flow**

```ts
it("fails before ClickHouse writes when the parquet path is missing", async () => {
  await expect(
    importSnapshotToClickHouse({
      manifestPath: "C:/missing/monthly-manifest.json",
      repository,
    }),
  ).rejects.toThrow(/monthly-manifest\.json/);

  expect(repository.registerImportStart).not.toHaveBeenCalled();
});

it("records a ready import after streaming parquet into the raw table", async () => {
  repository.importRawRowsFromParquet.mockResolvedValue({ rowCount: 2 });

  const result = await importSnapshotToClickHouse({
    manifestPath,
    repository,
    createImportVersion: () => "import-2026-04",
  });

  expect(repository.registerImportStart).toHaveBeenCalled();
  expect(repository.markImportReady).toHaveBeenCalledWith(
    expect.objectContaining({
      importVersion: "import-2026-04",
      snapshotMonth: "2026-04",
      rowCount: 2,
    }),
  );
  expect(result.rowCount).toBe(2);
});
```

- [ ] **Step 2: Run the import tests to verify the workspace does not exist yet**

Run: `npm test -- bulk/import/import.test.ts`
Expected: FAIL because `bulk/import/` has not been implemented yet.

- [ ] **Step 3: Implement manifest and config parsing**

```ts
export type BulkImportManifest = {
  snapshotMonth: string;
  snapshotId: string;
  source: {
    parquetPath: string;
    sizeBytes?: number;
    checksum?: {
      algorithm: "sha256";
      value: string;
    };
  };
};

export function parseImportCliArgs(argv: string[]) {
  const manifestPath = readRequiredFlag(argv, "--manifest");

  return {
    manifestPath,
  };
}
```

- [ ] **Step 4: Implement the raw import repository**

```ts
async importRawRowsFromParquet(params: {
  importVersion: string;
  snapshotMonth: string;
  parquetPath: string;
}) {
  const execResult = await this.client.exec({
    query: `
      INSERT INTO bulk_hostname_raw
      (
        import_version,
        snapshot_month,
        source_row_number,
        raw_hostname,
        raw_ip_address,
        raw_cname_target,
        raw_provider_hint
      )
      SELECT
        {import_version: String},
        {snapshot_month: String},
        rowNumberInAllBlocks() AS source_row_number,
        hostname,
        ip_address,
        cname_target,
        provider_hint
      FROM input(
        'hostname Nullable(String),
         ip_address Nullable(String),
         cname_target Nullable(String),
         provider_hint Nullable(String)'
      )
      FORMAT Parquet
    `,
    query_params: {
      import_version: params.importVersion,
      snapshot_month: params.snapshotMonth,
    },
    values: createReadStream(params.parquetPath),
  });

  await finished(execResult.stream);
}
```

- [ ] **Step 5: Implement the import orchestrator and CLI**

```ts
export async function importSnapshotToClickHouse(options: {
  manifestPath: string;
  repository: BulkImportRepository;
  createImportVersion?: () => string;
}) {
  const manifest = await readManifest(options.manifestPath);
  await verifyManifestSource(manifest);

  const importVersion = options.createImportVersion?.() ?? crypto.randomUUID();
  await options.repository.ensureSchema();
  await options.repository.registerImportStart({
    importVersion,
    snapshotMonth: manifest.snapshotMonth,
    sourceKey: await buildSourceKey(manifest.source.parquetPath, manifest.snapshotMonth),
  });

  const result = await options.repository.importRawRowsFromParquet({
    importVersion,
    snapshotMonth: manifest.snapshotMonth,
    parquetPath: manifest.source.parquetPath,
  });

  await options.repository.markImportReady({
    importVersion,
    snapshotMonth: manifest.snapshotMonth,
    rowCount: result.rowCount,
  });

  return result;
}
```

- [ ] **Step 6: Wire the new import command into `package.json` and docs**

```json
{
  "scripts": {
    "bulk:import": "tsx bulk/import/src/cli.ts",
    "bulk:import:compose": "docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:import --"
  }
}
```

- [ ] **Step 7: Run the import test suite**

Run: `npm test -- bulk/import/import.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add bulk/import package.json package-lock.json
git commit -m "feat: add clickhouse raw import workflow"
```

### Task 3: Build the ClickHouse serving transform and safe cutover workflow

**Files:**
- Create: `bulk/transform/src/types.ts`
- Create: `bulk/transform/src/config.ts`
- Create: `bulk/transform/src/repository.ts`
- Create: `bulk/transform/src/transformer.ts`
- Create: `bulk/transform/src/cli.ts`
- Create: `bulk/transform/transform.test.ts`
- Create: `bulk/transform/README.md`
- Modify: `bulk/api/src/repository.ts`
- Modify: `bulk/api/src/repository.test.ts`
- Test: `bulk/transform/transform.test.ts`

- [ ] **Step 1: Write failing transform tests for ready-load reuse and safe activation**

```ts
it("keeps the active load unchanged when the transform fails", async () => {
  repository.findReadyTransformBySourceKey.mockResolvedValue(null);
  repository.transformImportIntoServing.mockRejectedValue(new Error("bad raw row"));

  await expect(
    transformImportedSnapshot({
      snapshotMonth: "2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      repository,
      createLoadVersion: () => "load-2026-04",
    }),
  ).rejects.toThrow("bad raw row");

  expect(repository.activateLoad).not.toHaveBeenCalled();
  expect(repository.markTransformFailed).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the transform test to verify the new workflow is not implemented**

Run: `npm test -- bulk/transform/transform.test.ts`
Expected: FAIL because `bulk/transform/` does not exist yet.

- [ ] **Step 3: Implement ClickHouse transform SQL over raw rows**

```ts
async transformImportIntoServing(params: {
  loadVersion: string;
  importVersion: string;
  snapshotMonth: string;
}) {
  await this.client.command({
    query: `
      INSERT INTO bulk_hostname_serving
      (
        load_version,
        snapshot_month,
        ip_address,
        hostname,
        apex_domain,
        tld,
        first_label,
        cname_target,
        provider_hint
      )
      SELECT
        {load_version: String},
        snapshot_month,
        lowerUTF8(trim(BOTH ' ' FROM raw_ip_address)) AS ip_address,
        lowerUTF8(trim(BOTH ' ' FROM raw_hostname)) AS hostname,
        arrayStringConcat(arraySlice(splitByChar('.', lowerUTF8(trim(BOTH ' ' FROM raw_hostname))), -2), '.') AS apex_domain,
        arrayElement(splitByChar('.', lowerUTF8(trim(BOTH ' ' FROM raw_hostname))), -1) AS tld,
        arrayElement(splitByChar('.', lowerUTF8(trim(BOTH ' ' FROM raw_hostname))), 1) AS first_label,
        nullIf(lowerUTF8(trim(BOTH ' ' FROM raw_cname_target)), '') AS cname_target,
        nullIf(lowerUTF8(trim(BOTH ' ' FROM raw_provider_hint)), '') AS provider_hint
      FROM bulk_hostname_raw
      WHERE import_version = {import_version: String}
        AND snapshot_month = {snapshot_month: String}
        AND raw_hostname IS NOT NULL
        AND raw_hostname != ''
        AND raw_ip_address IS NOT NULL
        AND raw_ip_address != ''
    `,
    query_params: {
      load_version: params.loadVersion,
      import_version: params.importVersion,
      snapshot_month: params.snapshotMonth,
    },
  });
}
```

- [ ] **Step 4: Implement the transform orchestrator and cutover rules**

```ts
export async function transformImportedSnapshot(options: {
  snapshotMonth: string;
  importVersion: string;
  sourceKey: string;
  repository: BulkTransformRepository;
  createLoadVersion?: () => string;
}) {
  await options.repository.ensureSchema();

  const readyTransform = await options.repository.findReadyTransformBySourceKey(options.sourceKey);
  if (readyTransform) {
    await options.repository.activateLoad({
      loadVersion: readyTransform.loadVersion,
      snapshotMonth: readyTransform.snapshotMonth,
    });
    return readyTransform;
  }

  const loadVersion = options.createLoadVersion?.() ?? crypto.randomUUID();
  await options.repository.registerTransformStart({
    loadVersion,
    importVersion: options.importVersion,
    sourceKey: options.sourceKey,
    snapshotMonth: options.snapshotMonth,
  });

  try {
    const rowCount = await options.repository.transformImportIntoServing({
      loadVersion,
      importVersion: options.importVersion,
      snapshotMonth: options.snapshotMonth,
    });

    await options.repository.markTransformReady({
      loadVersion,
      importVersion: options.importVersion,
      sourceKey: options.sourceKey,
      snapshotMonth: options.snapshotMonth,
      rowCount,
    });
    await options.repository.activateLoad({
      loadVersion,
      snapshotMonth: options.snapshotMonth,
    });
  } catch (error) {
    await options.repository.markTransformFailed({
      loadVersion,
      importVersion: options.importVersion,
      sourceKey: options.sourceKey,
      snapshotMonth: options.snapshotMonth,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
```

- [ ] **Step 5: Update the bulk API repository only if serving view names or metadata queries changed**

```ts
SELECT DISTINCT
  hostname,
  snapshot_month
FROM bulk_active_reverse_ip_serving
WHERE ip_address = {ip_address: String}
ORDER BY hostname ASC
LIMIT {limit: UInt64}
```

- [ ] **Step 6: Run transform and API repository tests**

Run: `npm test -- bulk/transform/transform.test.ts bulk/api/src/repository.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add bulk/transform bulk/api/src/repository.ts bulk/api/src/repository.test.ts
git commit -m "feat: add clickhouse transform and safe cutover"
```

### Task 4: Remove DuckDB and old staging-based load paths from the app and docs

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `bulk/README.md`
- Modify: `bulk/ops/README.md`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `bulk/api/Dockerfile`
- Delete or retire: `bulk/ingest/*`
- Delete or retire: `bulk/load/*`
- Test: `bulk/api/src/app.test.ts`

- [ ] **Step 1: Write a failing smoke test around updated command names or environment defaults if needed**

```ts
it("exposes bulk routes without DuckDB-specific runtime assumptions", async () => {
  const response = await app.request("/health");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
  });
});
```

- [ ] **Step 2: Run the focused app tests before touching runtime docs**

Run: `npm test -- bulk/api/src/app.test.ts`
Expected: PASS or a focused baseline for later regression comparison.

- [ ] **Step 3: Remove DuckDB dependencies and replace scripts**

```json
{
  "scripts": {
    "bulk:import": "tsx bulk/import/src/cli.ts",
    "bulk:transform": "tsx bulk/transform/src/cli.ts",
    "bulk:import:compose": "docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:import --",
    "bulk:transform:compose": "docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:transform --"
  },
  "dependencies": {
    "@clickhouse/client": "^1.18.5",
    "@hono/node-server": "^2.0.2",
    "hono": "^4.12.18"
  }
}
```

- [ ] **Step 4: Update Docker and Compose runtime expectations**

```dockerfile
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY bulk/polars/requirements.txt /tmp/polars-requirements.txt
RUN pip3 install --no-cache-dir -r /tmp/polars-requirements.txt
```

```yaml
environment:
  CLICKHOUSE_HOST: clickhouse
  BULK_SNAPSHOT_ROOT: /var/lib/tech-stack-dashboard/bulk-snapshots
command: npm run bulk:api:start
```

- [ ] **Step 5: Rewrite operator docs from ingest/load to import/transform**

```md
docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:import -- --manifest /var/lib/tech-stack-dashboard/bulk-snapshots/input/YYYY-MM/monthly-manifest.json
docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:transform -- --snapshot-month YYYY-MM --source-key <source-key> --import-version <import-version>
python3 bulk/polars/src/report.py --input /tmp/export.csv --output /tmp/report.json
```

- [ ] **Step 6: Run the app test plus a package-level install verification**

Run: `npm test -- bulk/api/src/app.test.ts`
Expected: PASS

Run: `npm install`
Expected: PASS with `@duckdb/node-api` removed and no missing dependencies.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json bulk/README.md bulk/ops/README.md .env.example docker-compose.yml bulk/api/Dockerfile
git rm -r bulk/ingest bulk/load
git commit -m "refactor: replace duckdb staging pipeline with import transform flow"
```

### Task 5: Add the Polars post-load reporting workspace

**Files:**
- Create: `bulk/polars/requirements.txt`
- Create: `bulk/polars/src/report.py`
- Create: `bulk/polars/report.test.ts`
- Create: `bulk/polars/README.md`
- Modify: `bulk/ops/README.md`
- Test: `bulk/polars/report.test.ts`

- [ ] **Step 1: Write a failing test that verifies the Polars report contract**

```ts
it("builds a cleanup report from exported raw rows", async () => {
  const result = await runPolarsCleanupReport({
    inputCsvPath,
    outputJsonPath,
  });

  expect(result).toEqual({
    totalRows: 3,
    duplicateHostnames: 1,
    emptyIpRows: 1,
  });
});
```

- [ ] **Step 2: Run the Polars report test to confirm the workspace is absent**

Run: `npm test -- bulk/polars/report.test.ts`
Expected: FAIL because the report script and test harness do not exist yet.

- [ ] **Step 3: Add the Python Polars dependency and cleanup report script**

```txt
polars==1.31.0
```

```python
import argparse
import json
import polars as pl

def build_report(input_csv_path: str) -> dict:
    frame = pl.read_csv(input_csv_path)
    return {
        "totalRows": frame.height,
        "duplicateHostnames": frame.select(
            pl.col("hostname").is_duplicated().sum()
        ).item(),
        "emptyIpRows": frame.select(
            pl.col("ip_address").is_null().sum()
        ).item(),
    }

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--output")
    args = parser.parse_args()

    report = build_report(args.input)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(report, handle)
```

- [ ] **Step 4: Add a thin Node test harness that executes the Python report**

```ts
const result = spawnSync("python", ["bulk/polars/src/report.py", "--input", inputPath, "--output", outputPath], {
  cwd: projectRoot,
  stdio: "inherit",
});

expect(result.status).toBe(0);
const report = JSON.parse(await readFile(outputPath, "utf8"));
expect(report.totalRows).toBe(3);
```

- [ ] **Step 5: Run the Polars report tests**

Run: `npm test -- bulk/polars/report.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add bulk/polars bulk/ops/README.md
git commit -m "feat: add polars cleanup reporting workspace"
```

### Task 6: Migrate the server to the new import/transform flow and load April 2026

**Files:**
- Modify: `scripts/bootstrap-bulk-host.sh`
- Modify: `bulk/ops/README.md`
- Modify: `deploy-files.txt`
- Test: host verification commands in the runbook

- [ ] **Step 1: Write down the exact host verification sequence in the runbook**

```md
1. `docker compose --env-file .env.bulk up -d --build`
2. `docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:import -- --manifest /var/lib/tech-stack-dashboard/bulk-snapshots/input/2026-04/monthly-manifest.json`
3. `docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:transform -- --snapshot-month 2026-04 --import-version <captured-import-version> --source-key <captured-source-key>`
4. `curl -f "http://127.0.0.1:3000/api/subdomains?domain=example.com"`
```

- [ ] **Step 2: Run the focused local regression suite before shipping**

Run: `npm test -- bulk/import/import.test.ts bulk/transform/transform.test.ts bulk/api/src/repository.test.ts bulk/polars/report.test.ts`
Expected: PASS

- [ ] **Step 3: Rebuild and redeploy the bulk stack on the host**

```bash
tar -czf deploy-clickhouse-direct-bulk.tar.gz .
scp deploy-clickhouse-direct-bulk.tar.gz root@188.40.39.126:/root/
ssh root@188.40.39.126 "cd /opt/tech-stack-dashboard && tar -xzf /root/deploy-clickhouse-direct-bulk.tar.gz -C /opt/tech-stack-dashboard && docker compose --env-file .env.bulk up -d --build"
```

- [ ] **Step 4: Run the April 2026 import and transform on the host**

```bash
ssh root@188.40.39.126 "cd /opt/tech-stack-dashboard && docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:import -- --manifest /var/lib/tech-stack-dashboard/bulk-snapshots/input/2026-04/monthly-manifest.json"
ssh root@188.40.39.126 "cd /opt/tech-stack-dashboard && docker compose --env-file .env.bulk exec -T bulk-api npm run bulk:transform -- --snapshot-month 2026-04 --import-version <import-version> --source-key <source-key>"
```

- [ ] **Step 5: Run the post-load Polars cleanup report**

```bash
ssh root@188.40.39.126 "cd /opt/tech-stack-dashboard && python3 bulk/polars/src/report.py --input /tmp/april-export.csv --output /tmp/april-report.json && cat /tmp/april-report.json"
```

- [ ] **Step 6: Verify live cutover on the host**

Run:
- `curl -f "http://127.0.0.1:3000/api/subdomains?domain=example.com"`
- `curl -f "http://127.0.0.1:3000/api/cnames?domain=example.com"`
- `curl -f "http://127.0.0.1:3000/api/reverse-dns?ip=203.0.113.10"`

Expected: PASS with `snapshotMonth` reflecting `2026-04` after activation.

- [ ] **Step 7: Commit**

```bash
git add scripts/bootstrap-bulk-host.sh bulk/ops/README.md deploy-files.txt
git commit -m "docs: update host flow for clickhouse direct bulk pipeline"
```

## Self-Review

- Spec coverage:
  - DuckDB removal is covered in Tasks 2 and 4.
  - Direct ClickHouse raw import is covered in Tasks 1 and 2.
  - Safe transform-based cutover is covered in Tasks 1 and 3.
  - Polars post-load reporting is covered in Task 5.
  - April 2026 host migration is covered in Task 6.
- Placeholder scan:
  - No `TODO`, `TBD`, or “implement later” placeholders remain.
  - The only variable values left are runtime-captured identifiers such as
    `<import-version>` and `<source-key>`, which must be produced by the import
    command and echoed in its success output during implementation.
- Type consistency:
  - Import uses `importVersion` and `sourceKey`.
  - Transform uses `loadVersion`, `importVersion`, and `sourceKey`.
  - Active serving stays keyed by `loadVersion`.
