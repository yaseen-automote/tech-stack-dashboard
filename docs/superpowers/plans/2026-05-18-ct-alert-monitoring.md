# CT Alert Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an additive step-2 monitoring pipeline that ingests daily CT dumps from `cs2.ip.thc.org`, stores raw and normalized observations in ClickHouse, scores conservative phishing/brand/shadow-IT alerts, and exposes a dense dashboard feed.

**Architecture:** Add a new top-level `ct/` workspace for fetch, import, transform, and schema ownership while extending the existing `bulk/api/` backend and dashboard UI with CT-specific routes and tabs. The CT subsystem gets its own raw tables, serving tables, runtime state, and watchlist storage so it can be rolled back independently of the current step-1 recon engine.

**Tech Stack:** Node.js, TypeScript, ClickHouse, Hono, Next.js, Vitest, Docker Compose

---

## File Structure

### New files

- `ct/README.md`
- `ct/schema/clickhouse-ct.sql`
- `ct/fetch/README.md`
- `ct/fetch/fetch.test.ts`
- `ct/fetch/src/config.ts`
- `ct/fetch/src/fetcher.ts`
- `ct/fetch/src/cli.ts`
- `ct/import/README.md`
- `ct/import/import.test.ts`
- `ct/import/src/config.ts`
- `ct/import/src/repository.ts`
- `ct/import/src/importer.ts`
- `ct/import/src/cli.ts`
- `ct/transform/README.md`
- `ct/transform/transform.test.ts`
- `ct/transform/src/config.ts`
- `ct/transform/src/parser.ts`
- `ct/transform/src/matcher.ts`
- `ct/transform/src/repository.ts`
- `ct/transform/src/transformer.ts`
- `ct/transform/src/cli.ts`
- `ct/types.ts`
- `app/api/alerts/route.ts`
- `app/api/alerts/summary/route.ts`
- `app/api/watchlists/route.ts`
- `app/api/watchlists/[entryId]/route.ts`
- `lib/ct-monitoring.ts`

### Modified files

- `package.json`
- `package-lock.json`
- `docker-compose.yml`
- `bulk/api/src/app.ts`
- `bulk/api/src/app.test.ts`
- `bulk/api/src/service.ts`
- `bulk/api/src/repository.ts`
- `bulk/api/src/repository.test.ts`
- `components/dashboard-shell.tsx`
- `components/ui/sidebar-component.tsx`
- `app-shell.test.tsx`
- `bulk/api/Dockerfile`
- `bulk/ops/README.md`
- `deploy-files.txt`

### Optional follow-up files

- `app/api/alerts/route.test.ts`
- `app/api/alerts/summary/route.test.ts`
- `app/api/watchlists/route.test.ts`
- `app/api/watchlists/[entryId]/route.test.ts`

These tests should be added if the app test surface stays consistent with the
existing API route test pattern.

### Boundaries

- `ct/fetch/` owns remote CT dump discovery and manifest generation.
- `ct/import/` owns manifest verification and raw ClickHouse line ingestion.
- `ct/transform/` owns parsing, normalization, watchlist matching, and active
  alert load cutover.
- `bulk/api/` remains the backend service boundary for both step 1 and step 2.
- `components/dashboard-shell.tsx` remains the main dashboard shell and gains
  a new alert-monitoring tab.

### Task 1: Add CT schema and runtime-state boundaries

**Files:**
- Create: `ct/schema/clickhouse-ct.sql`
- Create: `ct/README.md`
- Test: `bulk/api/src/repository.test.ts`
- Modify: `deploy-files.txt`

- [ ] **Step 1: Write the failing schema-sensitive tests for CT active views**

```ts
it("defines CT raw, alert feed, and active runtime views in the DDL", async () => {
  const schema = await readFile(new URL("../../../ct/schema/clickhouse-ct.sql", import.meta.url), "utf8");

  expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_log_line_raw");
  expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_import_attempt_events");
  expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_domain_observation");
  expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_alert_feed");
  expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_watchlist_entry");
  expect(schema).toContain("CREATE VIEW IF NOT EXISTS ct_runtime_state_current");
  expect(schema).toContain("CREATE VIEW IF NOT EXISTS ct_active_alert_feed");
});
```

- [ ] **Step 2: Run the repository test to verify CT schema does not exist yet**

Run: `npm test -- bulk/api/src/repository.test.ts`
Expected: FAIL because `ct/schema/clickhouse-ct.sql` is missing.

- [ ] **Step 3: Add the CT ClickHouse schema**

```sql
CREATE TABLE IF NOT EXISTS ct_log_line_raw
(
  import_version String,
  dump_date Date,
  source_line_number UInt64,
  raw_line String,
  raw_line_sha256 FixedString(64),
  source_url String,
  source_sha256 FixedString(64),
  imported_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(dump_date)
ORDER BY (dump_date, import_version, source_line_number);

CREATE TABLE IF NOT EXISTS ct_import_attempt_events
(
  import_version String,
  dump_date Date,
  source_url String,
  source_gzip_path String,
  source_file_bytes UInt64,
  source_file_sha256 FixedString(64),
  status Enum8('importing' = 1, 'ready' = 2, 'failed' = 3),
  row_count UInt64 DEFAULT 0,
  error_message Nullable(String),
  recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (dump_date, import_version, recorded_at);

CREATE TABLE IF NOT EXISTS ct_domain_observation
(
  load_version String,
  dump_date Date,
  observed_domain String,
  registrable_domain String,
  first_label String,
  watch_parse_mode LowCardinality(String),
  issuer_name Nullable(String),
  not_before Nullable(DateTime64(3, 'UTC')),
  not_after Nullable(DateTime64(3, 'UTC')),
  raw_line_sha256 FixedString(64),
  loaded_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(dump_date)
ORDER BY (load_version, registrable_domain, observed_domain);

CREATE TABLE IF NOT EXISTS ct_alert_feed
(
  load_version String,
  alert_id String,
  dump_date Date,
  domain String,
  category LowCardinality(String),
  severity LowCardinality(String),
  watch_type LowCardinality(String),
  matched_term String,
  reasons Array(String),
  issuer_name Nullable(String),
  raw_line_sha256 FixedString(64),
  created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(dump_date)
ORDER BY (load_version, dump_date, severity, domain, alert_id);
```

- [ ] **Step 4: Add watchlist and CT runtime-state tables**

```sql
CREATE TABLE IF NOT EXISTS ct_watchlist_entry
(
  entry_id UUID,
  watch_type LowCardinality(String),
  term String,
  enabled Bool DEFAULT true,
  created_at DateTime64(3, 'UTC'),
  updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (watch_type, term, entry_id);

CREATE TABLE IF NOT EXISTS ct_runtime_state_events
(
  state_key LowCardinality(String),
  load_version String,
  dump_date Date,
  event_id UUID DEFAULT generateUUIDv7(),
  recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (state_key, recorded_at, event_id);

CREATE VIEW IF NOT EXISTS ct_runtime_state_current AS
SELECT
  state_key,
  argMax(load_version, tuple(recorded_at, event_id)) AS load_version,
  argMax(dump_date, tuple(recorded_at, event_id)) AS dump_date,
  max(recorded_at) AS latest_recorded_at
FROM ct_runtime_state_events
GROUP BY state_key;

CREATE VIEW IF NOT EXISTS ct_active_alert_feed AS
SELECT feed.*
FROM ct_alert_feed AS feed
INNER JOIN ct_runtime_state_current AS state
  ON state.state_key = 'ct_alert_feed'
 AND state.load_version = feed.load_version;
```

- [ ] **Step 5: Document the CT workspace boundary**

```md
- `ct/schema/clickhouse-ct.sql` owns step-2 CT raw, serving, alert, watchlist,
  and runtime-state tables.
- Step 2 must never reuse or overwrite the step-1 `bulk_*` serving tables.
- `ct_active_alert_feed` is the only view the dashboard alert feed should query.
```

- [ ] **Step 6: Include the CT schema in deployment packaging**

Add this line to `deploy-files.txt`:

```txt
ct/schema/clickhouse-ct.sql
```

- [ ] **Step 7: Run the focused test again**

Run: `npm test -- bulk/api/src/repository.test.ts`
Expected: PASS for the new CT schema assertions.

- [ ] **Step 8: Commit**

```bash
git add ct/schema/clickhouse-ct.sql ct/README.md deploy-files.txt bulk/api/src/repository.test.ts
git commit -m "feat: add ct monitoring schema"
```

### Task 2: Build daily CT dump fetch and manifest generation

**Files:**
- Create: `ct/fetch/src/config.ts`
- Create: `ct/fetch/src/fetcher.ts`
- Create: `ct/fetch/src/cli.ts`
- Create: `ct/fetch/fetch.test.ts`
- Create: `ct/fetch/README.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing fetch tests for index parsing and manifest output**

```ts
it("extracts a dated gzip dump from the CT source index", () => {
  const html = `
    <a href="2025-11-24.txt.gz">2025-11-24.txt.gz</a>
    <a href="2025-11-25.txt.gz">2025-11-25.txt.gz</a>
  `;

  expect(parseCtDumpIndex(html)).toEqual([
    { dumpDate: "2025-11-24", fileName: "2025-11-24.txt.gz" },
    { dumpDate: "2025-11-25", fileName: "2025-11-25.txt.gz" },
  ]);
});

it("writes a manifest after download and checksum calculation", async () => {
  const result = await fetchCtDumpForDate({
    targetDate: "2025-11-24",
    storageRoot: tempRoot,
    fetchText: vi.fn().mockResolvedValue('<a href="2025-11-24.txt.gz">2025-11-24.txt.gz</a>'),
    fetchBytes: vi.fn().mockResolvedValue(Buffer.from("gzip-bytes")),
  });

  expect(result.manifest.dumpDate).toBe("2025-11-24");
  expect(result.manifest.source.gzipPath).toContain("2025-11-24.txt.gz");
  expect(result.manifest.source.sizeBytes).toBeGreaterThan(0);
  expect(result.manifest.source.checksum.algorithm).toBe("sha256");
});
```

- [ ] **Step 2: Run the fetch test to verify the workspace is absent**

Run: `npm test -- ct/fetch/fetch.test.ts`
Expected: FAIL because the `ct/fetch` workspace does not exist yet.

- [ ] **Step 3: Implement source index parsing**

```ts
const CT_DUMP_PATTERN = /href="(?<file>\d{4}-\d{2}-\d{2}\.txt\.gz)"/g;

export function parseCtDumpIndex(html: string) {
  return [...html.matchAll(CT_DUMP_PATTERN)].map((match) => {
    const fileName = match.groups?.file ?? "";
    return {
      fileName,
      dumpDate: fileName.replace(/\.txt\.gz$/, ""),
    };
  });
}
```

- [ ] **Step 4: Implement download and manifest writing**

```ts
export async function fetchCtDumpForDate(options: {
  targetDate: string;
  storageRoot: string;
  fetchText?: (url: string) => Promise<string>;
  fetchBytes?: (url: string) => Promise<Buffer>;
}) {
  const indexHtml = await (options.fetchText ?? defaultFetchText)(CT_SOURCE_INDEX_URL);
  const dumps = parseCtDumpIndex(indexHtml);
  const match = dumps.find((dump) => dump.dumpDate === options.targetDate);

  if (!match) {
    throw new Error(`No CT dump was listed for ${options.targetDate}.`);
  }

  const downloadUrl = new URL(match.fileName, CT_SOURCE_INDEX_URL).toString();
  const gzipBytes = await (options.fetchBytes ?? defaultFetchBytes)(downloadUrl);
  const dumpDir = join(options.storageRoot, "ct", "input", options.targetDate);
  const gzipPath = join(dumpDir, match.fileName);
  await mkdir(dumpDir, { recursive: true });
  await writeFile(gzipPath, gzipBytes);

  const checksum = createHash("sha256").update(gzipBytes).digest("hex");
  const manifest = {
    dumpDate: options.targetDate,
    source: {
      sourceUrl: downloadUrl,
      gzipPath,
      sizeBytes: gzipBytes.byteLength,
      checksum: {
        algorithm: "sha256",
        value: checksum,
      },
    },
  };

  const manifestPath = join(dumpDir, "ct-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifestPath, manifest };
}
```

- [ ] **Step 5: Add CLI wiring**

```ts
const cliArgs = parseCtFetchCliArgs(process.argv.slice(2));
const result = await fetchCtDumpForDate({
  targetDate: cliArgs.date,
  storageRoot: cliArgs.storageRoot,
});
console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 6: Add npm scripts**

```json
{
  "scripts": {
    "ct:fetch": "tsx ct/fetch/src/cli.ts"
  }
}
```

- [ ] **Step 7: Run the fetch tests**

Run: `npm test -- ct/fetch/fetch.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add ct/fetch package.json package-lock.json
git commit -m "feat: add ct dump fetch workflow"
```

### Task 3: Build raw CT line import into ClickHouse

**Files:**
- Create: `ct/import/src/config.ts`
- Create: `ct/import/src/repository.ts`
- Create: `ct/import/src/importer.ts`
- Create: `ct/import/src/cli.ts`
- Create: `ct/import/import.test.ts`
- Create: `ct/import/README.md`

- [ ] **Step 1: Write failing import tests for gzip line ingestion**

```ts
it("fails before ClickHouse writes when the CT manifest is missing", async () => {
  await expect(
    importCtDumpToClickHouse({
      manifestPath: "C:/missing/ct-manifest.json",
      repository,
    }),
  ).rejects.toThrow(/ct-manifest\.json/);

  expect(repository.registerImportStart).not.toHaveBeenCalled();
});

it("streams gzip lines into raw ClickHouse rows and marks the import ready", async () => {
  repository.importRawCtLines.mockResolvedValue({ rowCount: 3 });

  const result = await importCtDumpToClickHouse({
    manifestPath,
    repository,
    createImportVersion: () => "ct-import-2025-11-24",
  });

  expect(repository.importRawCtLines).toHaveBeenCalledWith(
    expect.objectContaining({
      importVersion: "ct-import-2025-11-24",
      dumpDate: "2025-11-24",
    }),
  );
  expect(result.rowCount).toBe(3);
});
```

- [ ] **Step 2: Run the import tests to verify the workspace is absent**

Run: `npm test -- ct/import/import.test.ts`
Expected: FAIL because `ct/import` does not exist yet.

- [ ] **Step 3: Implement manifest parsing and verification**

```ts
export type CtImportManifest = {
  dumpDate: string;
  source: {
    sourceUrl: string;
    gzipPath: string;
    sizeBytes: number;
    checksum: {
      algorithm: "sha256";
      value: string;
    };
  };
};
```

- [ ] **Step 4: Implement raw line ingestion**

```ts
async importRawCtLines(params: {
  importVersion: string;
  dumpDate: string;
  sourceUrl: string;
  sourceSha256: string;
  gzipPath: string;
}) {
  const gzipStream = createReadStream(params.gzipPath).pipe(createGunzip());
  const readline = createInterface({ input: gzipStream, crlfDelay: Infinity });
  const rows: Array<Record<string, unknown>> = [];
  let lineNumber = 0;

  for await (const rawLine of readline) {
    lineNumber += 1;
    rows.push({
      import_version: params.importVersion,
      dump_date: params.dumpDate,
      source_line_number: lineNumber,
      raw_line: rawLine,
      raw_line_sha256: createHash("sha256").update(rawLine).digest("hex"),
      source_url: params.sourceUrl,
      source_sha256: params.sourceSha256,
    });
  }

  await this.client.insert({
    table: "ct_log_line_raw",
    values: rows,
    format: "JSONEachRow",
  });

  return { rowCount: rows.length };
}
```

- [ ] **Step 5: Record import metadata**

```ts
await repository.registerImportStart({
  importVersion,
  dumpDate: manifest.dumpDate,
  sourceUrl: manifest.source.sourceUrl,
  sourceGzipPath: manifest.source.gzipPath,
  sourceFileBytes: manifest.source.sizeBytes,
  sourceFileSha256: manifest.source.checksum.value,
  recordedAt: new Date().toISOString(),
});
```

- [ ] **Step 6: Add CLI and npm script**

```json
{
  "scripts": {
    "ct:import": "tsx ct/import/src/cli.ts"
  }
}
```

- [ ] **Step 7: Run the import tests**

Run: `npm test -- ct/import/import.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add ct/import package.json package-lock.json
git commit -m "feat: add ct raw import workflow"
```

### Task 4: Build parsing, normalization, matching, and active alert cutover

**Files:**
- Create: `ct/transform/src/config.ts`
- Create: `ct/transform/src/parser.ts`
- Create: `ct/transform/src/matcher.ts`
- Create: `ct/transform/src/repository.ts`
- Create: `ct/transform/src/transformer.ts`
- Create: `ct/transform/src/cli.ts`
- Create: `ct/transform/transform.test.ts`
- Create: `ct/transform/README.md`
- Create: `ct/types.ts`

- [ ] **Step 1: Write failing parser and matcher tests**

```ts
it("extracts hostnames from JSON CT lines", () => {
  const line = JSON.stringify({
    dns_names: ["secure-openai-login.net", "api.example.com"],
    issuer_name: "Let's Encrypt",
  });

  expect(parseCtRawLine(line)).toEqual({
    parseMode: "json",
    issuerName: "Let's Encrypt",
    notBefore: null,
    notAfter: null,
    domains: ["secure-openai-login.net", "api.example.com"],
  });
});

it("falls back to plain-line parsing when a line is a single hostname", () => {
  expect(parseCtRawLine("vpn-admin.internal-example.net")).toEqual({
    parseMode: "plain",
    issuerName: null,
    notBefore: null,
    notAfter: null,
    domains: ["vpn-admin.internal-example.net"],
  });
});

it("creates a high-severity phishing alert for a watched brand plus risky keyword", () => {
  const alert = scoreCtObservation({
    observedDomain: "secure-openai-login.net",
    watchlistEntries: [
      { watchType: "brand", term: "openai", enabled: true },
      { watchType: "keyword", term: "login", enabled: true },
      { watchType: "keyword", term: "secure", enabled: true },
    ],
  });

  expect(alert).toEqual({
    category: "phishing",
    severity: "high",
    matchedTerm: "openai",
    reasons: expect.arrayContaining([
      "contains watched brand term",
      "contains risky keyword: login",
    ]),
  });
});
```

- [ ] **Step 2: Run the transform tests to confirm the workspace is absent**

Run: `npm test -- ct/transform/transform.test.ts`
Expected: FAIL because `ct/transform` does not exist yet.

- [ ] **Step 3: Implement the line parser adapter**

```ts
export function parseCtRawLine(rawLine: string): ParsedCtLine {
  const trimmed = rawLine.trim();

  if (trimmed.startsWith("{")) {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      parseMode: "json",
      issuerName: pickOptionalString(payload, ["issuer_name", "issuer", "ca"]),
      notBefore: pickOptionalDate(payload, ["not_before", "valid_from"]),
      notAfter: pickOptionalDate(payload, ["not_after", "valid_to"]),
      domains: extractHostnameCandidates([
        payload.name_value,
        payload.common_name,
        payload.dns_names,
        payload.subject_alt_names,
        payload.all_domains,
      ]),
    };
  }

  if (trimmed.includes("\t")) {
    return {
      parseMode: "tsv",
      issuerName: null,
      notBefore: null,
      notAfter: null,
      domains: extractHostnameCandidates(trimmed.split("\t")),
    };
  }

  return {
    parseMode: "plain",
    issuerName: null,
    notBefore: null,
    notAfter: null,
    domains: extractHostnameCandidates([trimmed]),
  };
}
```

- [ ] **Step 4: Implement conservative matching**

```ts
export function scoreCtObservation(options: {
  observedDomain: string;
  watchlistEntries: CtWatchlistEntry[];
}) {
  const brandTerms = options.watchlistEntries.filter((entry) => entry.watchType === "brand");
  const internalTerms = options.watchlistEntries.filter((entry) => entry.watchType === "internal");
  const riskyKeywords = options.watchlistEntries.filter((entry) => entry.watchType === "keyword");

  const matchedBrand = brandTerms.find((entry) => options.observedDomain.includes(entry.term));
  const matchedInternal = internalTerms.find((entry) => options.observedDomain.includes(entry.term));
  const matchedKeywords = riskyKeywords.filter((entry) => options.observedDomain.includes(entry.term));

  if (matchedBrand && matchedKeywords.length > 0) {
    return {
      category: "phishing",
      severity: "high",
      matchedTerm: matchedBrand.term,
      reasons: [
        "contains watched brand term",
        ...matchedKeywords.map((entry) => `contains risky keyword: ${entry.term}`),
      ],
    };
  }

  if (matchedInternal) {
    return {
      category: "shadow-it",
      severity: "high",
      matchedTerm: matchedInternal.term,
      reasons: ["contains watched internal identifier"],
    };
  }

  if (matchedBrand) {
    return {
      category: "brand-protection",
      severity: "medium",
      matchedTerm: matchedBrand.term,
      reasons: ["contains watched brand term"],
    };
  }

  return null;
}
```

- [ ] **Step 5: Transform raw lines into observations and alert feed rows**

```ts
const parsedRows = rawRows.flatMap((row) => {
  const parsed = parseCtRawLine(String(row.raw_line));
  return parsed.domains.map((domain) => ({
    dumpDate: String(row.dump_date),
    observedDomain: domain,
    parseMode: parsed.parseMode,
    issuerName: parsed.issuerName,
    notBefore: parsed.notBefore,
    notAfter: parsed.notAfter,
    rawLineSha256: String(row.raw_line_sha256),
  }));
});

const alerts = parsedRows.flatMap((row) => {
  const scored = scoreCtObservation({
    observedDomain: row.observedDomain,
    watchlistEntries,
  });

  if (!scored) {
    return [];
  }

  return [{
    alertId: createHash("sha256").update(`${row.dumpDate}:${row.observedDomain}:${scored.category}:${scored.matchedTerm}`).digest("hex"),
    dumpDate: row.dumpDate,
    domain: row.observedDomain,
    ...scored,
    issuerName: row.issuerName,
    rawLineSha256: row.rawLineSha256,
  }];
});
```

- [ ] **Step 6: Add CT runtime-state activation**

```ts
await repository.activateCtAlertLoad({
  loadVersion,
  dumpDate,
});
```

- [ ] **Step 7: Run the transform tests**

Run: `npm test -- ct/transform/transform.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add ct/transform ct/types.ts
git commit -m "feat: add ct parsing and alert matching"
```

### Task 5: Extend the backend service with CT alert and watchlist routes

**Files:**
- Modify: `bulk/api/src/app.ts`
- Modify: `bulk/api/src/service.ts`
- Modify: `bulk/api/src/repository.ts`
- Modify: `bulk/api/src/app.test.ts`
- Modify: `bulk/api/src/repository.test.ts`
- Create: `lib/ct-monitoring.ts`

- [ ] **Step 1: Write failing backend route tests**

```ts
it("returns CT alert summary data", async () => {
  vi.mocked(lookupService.lookupCtAlertSummary).mockResolvedValue({
    newestDumpDate: "2025-11-24",
    totals: {
      alerts: 12,
      phishing: 4,
      brandProtection: 5,
      shadowIt: 3,
      highSeverity: 7,
    },
  });

  const response = await request(app, "/v1/ct/alerts/summary");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    newestDumpDate: "2025-11-24",
    totals: {
      alerts: 12,
      phishing: 4,
      brandProtection: 5,
      shadowIt: 3,
      highSeverity: 7,
    },
  });
});

it("returns CT alert feed rows", async () => {
  vi.mocked(lookupService.lookupCtAlerts).mockResolvedValue({
    results: [
      {
        id: "alert-1",
        observedAt: "2025-11-24",
        domain: "secure-openai-login.net",
        category: "phishing",
        severity: "high",
        matchedTerm: "openai",
        reasons: ["contains watched brand term"],
      },
    ],
  });

  const response = await request(app, "/v1/ct/alerts");

  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run the focused backend tests**

Run: `npm test -- bulk/api/src/app.test.ts bulk/api/src/repository.test.ts`
Expected: FAIL because CT routes and repository methods do not exist yet.

- [ ] **Step 3: Add CT repository query methods**

```ts
lookupCtAlertSummary(): Promise<CtAlertSummary>;
lookupCtAlerts(params: { category?: string; severity?: string; limit: number; offset: number }): Promise<CtAlertFeedRow[]>;
listCtWatchlistEntries(): Promise<CtWatchlistEntry[]>;
createCtWatchlistEntry(params: { watchType: string; term: string }): Promise<CtWatchlistEntry>;
updateCtWatchlistEntry(params: { entryId: string; enabled: boolean }): Promise<CtWatchlistEntry | null>;
deleteCtWatchlistEntry(params: { entryId: string }): Promise<boolean>;
```

- [ ] **Step 4: Query the active CT feed and summary**

```ts
SELECT
  count() AS alert_count,
  countIf(category = 'phishing') AS phishing_count,
  countIf(category = 'brand-protection') AS brand_count,
  countIf(category = 'shadow-it') AS shadow_count,
  countIf(severity = 'high') AS high_severity_count,
  max(dump_date) AS newest_dump_date
FROM ct_active_alert_feed
```

```ts
SELECT
  alert_id,
  dump_date,
  domain,
  category,
  severity,
  watch_type,
  matched_term,
  reasons,
  issuer_name
FROM ct_active_alert_feed
ORDER BY dump_date DESC, severity ASC, domain ASC
LIMIT {limit: UInt64}
OFFSET {offset: UInt64}
```

- [ ] **Step 5: Add service methods and Hono routes**

```ts
app.get("/v1/ct/alerts", async (c) => {
  const response = await options.lookupService.lookupCtAlerts({
    category: c.req.query("category") ?? undefined,
    severity: c.req.query("severity") ?? undefined,
    limit: normalizeLimit(c.req.query("limit"), 100),
    offset: Number(c.req.query("offset") ?? 0),
  });

  return c.json(response);
});

app.get("/v1/ct/alerts/summary", async (c) => c.json(await options.lookupService.lookupCtAlertSummary()));
```

- [ ] **Step 6: Add watchlist CRUD routes**

```ts
app.get("/v1/ct/watchlists", async (c) => c.json(await options.lookupService.listCtWatchlistEntries()));
app.post("/v1/ct/watchlists", async (c) => c.json(await options.lookupService.createCtWatchlistEntry(await c.req.json())));
app.patch("/v1/ct/watchlists/:entryId", async (c) => c.json(await options.lookupService.updateCtWatchlistEntry({
  entryId: c.req.param("entryId"),
  ...(await c.req.json() as { enabled: boolean }),
})));
app.delete("/v1/ct/watchlists/:entryId", async (c) => c.json({ ok: await options.lookupService.deleteCtWatchlistEntry({ entryId: c.req.param("entryId") }) }));
```

- [ ] **Step 7: Run the backend tests**

Run: `npm test -- bulk/api/src/app.test.ts bulk/api/src/repository.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add bulk/api/src/app.ts bulk/api/src/service.ts bulk/api/src/repository.ts bulk/api/src/app.test.ts bulk/api/src/repository.test.ts lib/ct-monitoring.ts
git commit -m "feat: add ct alert backend routes"
```

### Task 6: Add browser proxy routes and dashboard alert feed

**Files:**
- Create: `app/api/alerts/route.ts`
- Create: `app/api/alerts/summary/route.ts`
- Create: `app/api/watchlists/route.ts`
- Create: `app/api/watchlists/[entryId]/route.ts`
- Modify: `components/dashboard-shell.tsx`
- Modify: `components/ui/sidebar-component.tsx`
- Modify: `app-shell.test.tsx`

- [ ] **Step 1: Write failing dashboard tests for the new alert tab**

```tsx
it("switches to CT Monitor and renders alert summary plus feed rows", async () => {
  vi.spyOn(global, "fetch")
    .mockResolvedValueOnce(Response.json({
      newestDumpDate: "2025-11-24",
      totals: {
        alerts: 12,
        phishing: 4,
        brandProtection: 5,
        shadowIt: 3,
        highSeverity: 7,
      },
    }))
    .mockResolvedValueOnce(Response.json({
      results: [
        {
          id: "alert-1",
          observedAt: "2025-11-24",
          domain: "secure-openai-login.net",
          category: "phishing",
          severity: "high",
          matchedTerm: "openai",
          reasons: ["contains watched brand term"],
        },
      ],
    }));

  render(<DashboardShell />);
  fireEvent.click(screen.getAllByRole("button", { name: /ct monitor/i })[0]);

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "CT Monitor Alerts" })).toBeInTheDocument();
  });

  expect(screen.getByText("secure-openai-login.net")).toBeInTheDocument();
  expect(screen.getByText("12 alerts")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the dashboard test to confirm the tab does not exist yet**

Run: `npm test -- app-shell.test.tsx`
Expected: FAIL because there is no CT Monitor tab or alert UI.

- [ ] **Step 3: Add browser proxy routes**

```ts
export async function GET() {
  const upstreamUrl = new URL("/v1/ct/alerts", getBulkApiBaseUrl());
  const response = await fetch(upstreamUrl, { cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.ok ? 200 : 502 });
}
```

- [ ] **Step 4: Extend the dashboard tab model**

```ts
export type TabId = "subdomain" | "cname" | "reverse-dns" | "tech-stack" | "ct-monitor";
```

```ts
  "ct-monitor": {
    label: "CT Monitor",
    endpoint: "/api/alerts",
    queryParam: "target",
    resultsHeading: "CT Monitor Alerts",
    resultColumnTitle: "Domain",
    noResultsTitle: "No alerts",
    noResultsHint: "No matching CT observations were found for the active watchlists.",
    loadingLabel: "alerts",
    emptyPrompt: "Alerts will appear here after CT monitoring data is loaded",
    resultMode: "ct",
    normalizeQuery: () => "alerts",
    buildValidationMessage: () => "",
  },
```

- [ ] **Step 5: Fetch summary + feed for the CT tab**

```ts
if (activeTab === "ct-monitor") {
  const [summaryResponse, alertsResponse] = await Promise.all([
    fetch("/api/alerts/summary", { signal: abortController.signal, cache: "no-store" }),
    fetch("/api/alerts", { signal: abortController.signal, cache: "no-store" }),
  ]);

  const summaryPayload = await summaryResponse.json();
  const alertsPayload = await alertsResponse.json();
  setCtSummary(summaryPayload);
  setResults(alertsPayload.results);
  return;
}
```

- [ ] **Step 6: Render dense alert summary cards and table**

```tsx
function CtAlertResultsTable({ results }: { results: CtAlertFeedRow[] }) {
  return (
    <table className="w-full min-w-[860px] text-left text-[13px]">
      <thead>
        <tr>
          <th>Observed</th>
          <th>Domain</th>
          <th>Category</th>
          <th>Severity</th>
          <th>Matched Term</th>
          <th>Reasons</th>
        </tr>
      </thead>
      <tbody>
        {results.map((result) => (
          <tr key={result.id}>
            <td>{result.observedAt}</td>
            <td className="font-mono">{result.domain}</td>
            <td>{result.category}</td>
            <td>{result.severity}</td>
            <td>{result.matchedTerm}</td>
            <td>{result.reasons.join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 7: Run the dashboard tests**

Run: `npm test -- app-shell.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/api/alerts app/api/watchlists components/dashboard-shell.tsx components/ui/sidebar-component.tsx app-shell.test.tsx
git commit -m "feat: add ct monitor dashboard feed"
```

### Task 7: Wire runtime, docs, and deployment

**Files:**
- Modify: `package.json`
- Modify: `docker-compose.yml`
- Modify: `bulk/api/Dockerfile`
- Modify: `bulk/ops/README.md`
- Modify: `deploy-files.txt`
- Create: `ct/README.md`

- [ ] **Step 1: Add npm scripts for the CT pipeline**

```json
{
  "scripts": {
    "ct:fetch": "tsx ct/fetch/src/cli.ts",
    "ct:import": "tsx ct/import/src/cli.ts",
    "ct:transform": "tsx ct/transform/src/cli.ts",
    "ct:fetch:compose": "docker compose --env-file .env.bulk exec -T bulk-api npm run ct:fetch --",
    "ct:import:compose": "docker compose --env-file .env.bulk exec -T bulk-api npm run ct:import --",
    "ct:transform:compose": "docker compose --env-file .env.bulk exec -T bulk-api npm run ct:transform --"
  }
}
```

- [ ] **Step 2: Ensure the bulk-api container includes the `ct/` workspace**

```dockerfile
COPY ct ./ct
```

- [ ] **Step 3: Document the daily CT flow**

```md
1. `npm run ct:fetch -- --date YYYY-MM-DD`
2. `npm run ct:import -- --manifest /var/lib/tech-stack-dashboard/bulk-snapshots/ct/input/YYYY-MM-DD/ct-manifest.json`
3. `npm run ct:transform -- --dump-date YYYY-MM-DD --import-version <import-version>`
4. `curl -f "http://127.0.0.1:3000/api/alerts"`
```

- [ ] **Step 4: Document rollback**

```md
- To disable step 2, stop running `ct:fetch`, `ct:import`, and `ct:transform`.
- Remove or hide the `CT Monitor` tab if needed.
- Step-1 `bulk_*` tables and routes are unaffected by CT rollback.
```

- [ ] **Step 5: Run the full local verification set**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json docker-compose.yml bulk/api/Dockerfile bulk/ops/README.md deploy-files.txt ct/README.md
git commit -m "docs: wire ct monitoring runtime and ops flow"
```

### Task 8: Stage and verify host deployment safely

**Files:**
- Modify: `bulk/ops/README.md`
- Modify: `deploy-files.txt`

- [ ] **Step 1: Re-run the focused local verification before shipping**

Run: `npm test -- ct/fetch/fetch.test.ts ct/import/import.test.ts ct/transform/transform.test.ts bulk/api/src/app.test.ts app-shell.test.tsx`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 2: Sync the updated deploy archive to the host**

```bash
tar -czf deploy-ct-alert-monitoring.tar.gz .
scp deploy-ct-alert-monitoring.tar.gz root@188.40.39.126:/root/
```

- [ ] **Step 3: Rebuild the dashboard and backend on the host**

```bash
ssh root@188.40.39.126 "cd /opt/tech-stack-dashboard && tar -xzf /root/deploy-ct-alert-monitoring.tar.gz -C /opt/tech-stack-dashboard && docker-compose --env-file .env.bulk up -d --build bulk-api dashboard"
```

- [ ] **Step 4: Run one manual CT batch on the host**

```bash
ssh root@188.40.39.126 "cd /opt/tech-stack-dashboard && docker-compose --env-file .env.bulk exec -T bulk-api npm run ct:fetch -- --date 2025-11-24"
ssh root@188.40.39.126 "cd /opt/tech-stack-dashboard && docker-compose --env-file .env.bulk exec -T bulk-api npm run ct:import -- --manifest /var/lib/tech-stack-dashboard/bulk-snapshots/ct/input/2025-11-24/ct-manifest.json"
ssh root@188.40.39.126 "cd /opt/tech-stack-dashboard && docker-compose --env-file .env.bulk exec -T bulk-api npm run ct:transform -- --dump-date 2025-11-24 --import-version <import-version>"
```

- [ ] **Step 5: Verify the public CT feed**

Run:
- `curl -f "http://127.0.0.1:3000/api/alerts"`
- `curl -f "http://127.0.0.1:3000/api/alerts/summary"`
- `curl -f "http://127.0.0.1:3000/api/subdomains?domain=example.com"`

Expected:
- CT routes return JSON without breaking
- existing step-1 routes still return data

- [ ] **Step 6: Commit deployment doc updates**

```bash
git add bulk/ops/README.md deploy-files.txt
git commit -m "docs: add ct monitoring deployment flow"
```

## Self-Review

- Spec coverage:
  - daily batch source ingestion is covered in Tasks 2 and 3
  - conservative alert scoring is covered in Task 4
  - dashboard feed delivery is covered in Task 6
  - additive rollout and rollback are covered in Tasks 7 and 8
- Placeholder scan:
  - no `TODO`, `TBD`, or “implement later” placeholders remain
  - runtime-captured values such as `<import-version>` are produced by earlier
    commands in the plan and are not unspecified design gaps
- Type consistency:
  - `dumpDate`, `importVersion`, and `loadVersion` stay distinct across fetch,
    import, and transform
  - watchlists are consistently modeled as `watchType`, `term`, and `enabled`
  - the dashboard consumes `ct_alert_feed` rows through `/api/alerts`
