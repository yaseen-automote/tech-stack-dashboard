// @vitest-environment node

import { readFile } from "node:fs/promises";

import { ClickHouseBulkApiRepository } from "./repository";

type QueryCall = {
  query: string;
  query_params?: Record<string, unknown>;
  format?: string;
};

type InsertCall = {
  table: string;
  values: Array<Record<string, unknown>>;
  format?: string;
};

class MockClickHouseClient {
  readonly calls: QueryCall[] = [];
  readonly commands: QueryCall[] = [];
  readonly inserts: InsertCall[] = [];
  private readonly responses: Array<Record<string, unknown>[]>;

  constructor(responses: Array<Record<string, unknown>[]>) {
    this.responses = [...responses];
  }

  async command(call: QueryCall) {
    this.commands.push(call);
    return { query_id: `command-${this.commands.length}` };
  }

  async insert(call: InsertCall) {
    this.inserts.push(call);
    return { query_id: `insert-${this.inserts.length}` };
  }

  async query(call: QueryCall) {
    this.calls.push(call);
    const rows = this.responses.shift() ?? [];

    return {
      json: async <T>() => rows as T,
    };
  }
}

type HostnameServingRow = {
  load_version: string;
  snapshot_month: string;
  ip_address: string;
  hostname: string;
  apex_domain: string;
  tld: string;
  first_label: string;
  cname_target: string | null;
  provider_hint: string | null;
};

type RuntimeStateRow = {
  state_key: string;
  load_version: string;
  snapshot_month: string;
};

class RuntimeCutoverClickHouseClient {
  private readonly hostnameServingRows: HostnameServingRow[] = [];
  private readonly runtimeStateRows: RuntimeStateRow[] = [];

  async command(call: { query: string }) {
    const query = call.query.trim();

    if (query.includes("INSERT INTO bulk_runtime_state_events")) {
      const valuesMatch = query.match(
        /VALUES\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,/i,
      );

      if (!valuesMatch) {
        throw new Error("Test helper could not parse bulk_runtime_state_events insert.");
      }

      this.runtimeStateRows.push({
        state_key: valuesMatch[1] ?? "",
        load_version: valuesMatch[2] ?? "",
        snapshot_month: valuesMatch[3] ?? "",
      });
      return { query_id: `insert-state-${this.runtimeStateRows.length}` };
    }

    return { query_id: "command-ignored" };
  }

  async insert() {
    return { query_id: "insert-ignored" };
  }

  async exec(call: { query: string; values: HostnameServingRow[] }) {
    if (!call.query.includes("INSERT INTO bulk_hostname_serving")) {
      throw new Error("Test helper only supports bulk_hostname_serving inserts.");
    }

    this.hostnameServingRows.push(...call.values);

    return {
      query_id: `insert-hostname-${this.hostnameServingRows.length}`,
      stream: {
        resume() {},
        on() {},
        once() {},
        emit() {
          return false;
        },
        readable: false,
      },
    };
  }

  async query(call: { query: string; query_params?: Record<string, unknown>; format?: string }) {
    if (!call.query.includes("FROM bulk_active_hostname_serving") && !call.query.includes("FROM bulk_active_reverse_ip_lookup")) {
      throw new Error("Test helper only supports active serving queries.");
    }

    const activeState = [...this.runtimeStateRows]
      .reverse()
      .find((row) => row.state_key === "hostname_serving");

    const ipAddress = String(call.query_params?.ip_address ?? "");
    const limit = Number(call.query_params?.limit ?? 0);

    const rows = this.hostnameServingRows
      .filter(
        (row) =>
          row.ip_address === ipAddress &&
          row.load_version === activeState?.load_version,
      )
      .sort((left, right) => left.hostname.localeCompare(right.hostname))
      .slice(0, limit)
      .map((row) => ({
        hostname: row.hostname,
        snapshot_month: row.snapshot_month,
      }));

    return {
      json: async <T>() => rows as T,
    };
  }
}

async function readSchemaAsset(fileName: string) {
  return readFile(new URL(`../../schema/${fileName}`, import.meta.url), "utf8");
}

async function readCtSchemaAsset() {
  return readFile(new URL("../../../ct/schema/clickhouse-ct.sql", import.meta.url), "utf8");
}

describe("ClickHouseBulkApiRepository", () => {
  it("defines deterministic latest-state and active serving views in the ddl", async () => {
    const [rawSchema, servingSchema] = await Promise.all([
      readSchemaAsset("clickhouse-raw.sql"),
      readSchemaAsset("clickhouse-serving.sql"),
    ]);

    expect(rawSchema).toContain("CREATE TABLE IF NOT EXISTS bulk_hostname_raw");
    expect(servingSchema).toMatch(
      /CREATE TABLE IF NOT EXISTS bulk_transform_attempt_events[\s\S]*event_id UUID DEFAULT generateUUIDv7\(\)/,
    );
    expect(servingSchema).toMatch(
      /CREATE VIEW IF NOT EXISTS bulk_transform_attempts_latest[\s\S]*argMax\(import_version, tuple\(recorded_at, event_id\)\) AS import_version[\s\S]*argMax\(status, tuple\(recorded_at, event_id\)\) AS status/,
    );
    expect(servingSchema).toMatch(
      /CREATE TABLE IF NOT EXISTS bulk_runtime_state_events[\s\S]*event_id UUID DEFAULT generateUUIDv7\(\)/,
    );
    expect(servingSchema).toMatch(
      /CREATE VIEW IF NOT EXISTS bulk_runtime_state_current[\s\S]*argMax\(load_version, tuple\(recorded_at, event_id\)\) AS load_version[\s\S]*argMax\(snapshot_month, tuple\(recorded_at, event_id\)\) AS snapshot_month/,
    );
    expect(servingSchema).toMatch(
      /CREATE VIEW IF NOT EXISTS bulk_active_hostname_serving[\s\S]*INNER JOIN bulk_runtime_state_current AS state[\s\S]*state\.state_key = 'hostname_serving'[\s\S]*state\.load_version = serving\.load_version/,
    );
    expect(servingSchema).toMatch(
      /CREATE TABLE IF NOT EXISTS bulk_reverse_ip_lookup[\s\S]*ORDER BY \(load_version, ip_address, hostname\)/,
    );
    expect(servingSchema).toMatch(
      /CREATE VIEW IF NOT EXISTS bulk_active_reverse_ip_lookup[\s\S]*state\.state_key = 'hostname_serving'[\s\S]*state\.load_version = lookup\.load_version/,
    );
  });

  it("defines CT raw, alert feed, and active runtime views in the DDL", async () => {
    const schema = await readCtSchemaAsset();

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_log_line_raw");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_import_attempt_events");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_domain_observation");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_alert_feed");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS ct_watchlist_entry");
    expect(schema).toContain("CREATE VIEW IF NOT EXISTS ct_runtime_state_current");
    expect(schema).toContain("CREATE VIEW IF NOT EXISTS ct_active_alert_feed");
  });

  it("reads reverse-ip rows from the active serving view after runtime cutover", async () => {
    const client = new RuntimeCutoverClickHouseClient();
    const repository = new ClickHouseBulkApiRepository({ client });

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
          load_version: "load-2026-03",
          snapshot_month: "2026-03",
          ip_address: "203.0.113.10",
          hostname: "legacy.example.com",
          apex_domain: "example.com",
          tld: "com",
          first_label: "legacy",
          cname_target: "old-edge.example.net",
          provider_hint: "akamai",
        },
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
        VALUES ('hostname_serving', 'load-2026-03', '2026-03', now64(3))
      `,
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
    expect(rows).not.toContainEqual({
      hostname: "legacy.example.com",
      snapshotMonth: "2026-03",
    });
  });

  it("queries the active reverse-ip serving view", async () => {
    const client = new MockClickHouseClient([
      [
        {
          hostname: "mail.example.com",
          snapshot_month: "2026-04",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.lookupReverseIp({
      ip: "203.0.113.10",
      limit: 25,
    });

    expect(client.calls[0]?.query).toContain("FROM bulk_active_reverse_ip_lookup");
    expect(client.calls[0]?.query_params).toEqual({
      ip_address: "203.0.113.10",
      limit: 25,
    });
    expect(result).toEqual([
      {
        hostname: "mail.example.com",
        snapshotMonth: "2026-04",
      },
    ]);
  });

  it("queries apex domains from the split apex lookup table", async () => {
    const client = new MockClickHouseClient([
      [
        {
          hostname: "example.com",
          apex_domain: "example.com",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.lookupSubdomains({
      scope: "domains",
      filters: [
        {
          id: "filter-1",
          term: "example",
          modifier: "contains",
          include: true,
        },
      ],
      addedSince: "2026-04-15T00:00:00.000Z",
      includeInactive: false,
      limit: 50,
      offset: 30,
    });

    expect(client.calls[0]?.query).toContain("FROM tech_stack_bulk.bulk_apex_domain_lookup AS lookup");
    expect(client.calls[0]?.query).not.toContain("UNION ALL");
    expect(client.calls[0]?.query).not.toContain("tech_stack_bulk.domain_liveness_status");
    expect(client.calls[0]?.query).toContain("toDate(lookup.updated_at) >= toDate({addedSince:String})");
    expect(client.calls[0]?.query).toContain("lookup.domain AS hostname");
    expect(client.calls[0]?.query).toContain("lookup.domain AS apex_domain");
    expect(client.calls[0]?.query).toContain("lookup.search_text LIKE {term_0:String}");
    expect(client.calls[0]?.query).toContain("lookup.is_functional != 0");
    expect(client.calls[0]?.query_params).toEqual({
      addedSince: "2026-04-15",
      term_0: "%example%",
      limit: 50,
      offset: 30,
    });
    expect(result).toEqual([
      {
        hostname: "example.com",
        apexDomain: "example.com",
      },
    ]);
  });

  it("queries subdomains from the split subdomain lookup table with parent-domain optimization", async () => {
    const client = new MockClickHouseClient([
      [
        {
          hostname: "api.example.com",
          apex_domain: "example.com",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.lookupSubdomains({
      scope: "subdomains",
      filters: [
        {
          id: "filter-1",
          term: "example.com",
          modifier: "ends",
          include: true,
        },
        {
          id: "filter-2",
          term: "staging",
          modifier: "contains",
          include: false,
        },
      ],
      includeInactive: true,
      limit: Number.NaN,
      offset: 2000,
    });

    expect(client.calls[0]?.query).toContain("FROM tech_stack_bulk.bulk_subdomain_lookup_v2 AS lookup");
    expect(client.calls[0]?.query).not.toContain("FROM tech_stack_bulk.bulk_apex_domain_lookup");
    expect(client.calls[0]?.query).toContain("lookup.hostname AS hostname");
    expect(client.calls[0]?.query).toContain("lookup.parent_domain AS apex_domain");
    expect(client.calls[0]?.query).toContain("lookup.hostname_reversed LIKE {term_0:String}");
    expect(client.calls[0]?.query).toContain("lookup.parent_domain = {parent_domain_0:String}");
    expect(client.calls[0]?.query).toContain("NOT (lookup.search_text LIKE {term_1:String})");
    expect(client.calls[0]?.query).not.toContain("tech_stack_bulk.domain_liveness_status");
    expect(client.calls[0]?.query).toContain("LIMIT {limit: UInt64}");
    expect(client.calls[0]?.query_params).toEqual({
      term_0: "moc.elpmaxe%",
      parent_domain_0: "example.com",
      term_1: "%staging%",
      limit: 10000,
      offset: 2000,
    });
    expect(result).toEqual([
      {
        hostname: "api.example.com",
        apexDomain: "example.com",
      },
    ]);
  });

  it("rejects unbounded subdomain searches before querying ClickHouse", async () => {
    const client = new MockClickHouseClient([]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await expect(
      repository.lookupSubdomains({
        scope: "both",
        filters: [
          {
            id: "filter-1",
            term: "*",
            modifier: "contains",
            include: true,
          },
          {
            id: "filter-2",
            term: "   ",
            modifier: "contains",
            include: true,
          },
        ],
      }),
    ).rejects.toThrow("Enter at least one search term to inspect subdomain infrastructure.");
    expect(client.calls).toHaveLength(0);
  });

  it("rejects raw SQL wildcard characters before querying ClickHouse", async () => {
    const client = new MockClickHouseClient([]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await expect(
      repository.lookupSubdomains({
        scope: "both",
        filters: [
          {
            id: "filter-1",
            term: "exa_mple",
            modifier: "contains",
            include: true,
          },
        ],
        limit: 100,
      }),
    ).rejects.toThrow("Use * as the only wildcard in domain and subdomain search terms.");
    expect(client.calls).toHaveLength(0);
  });

  it("rejects malformed addedSince dates before querying ClickHouse", async () => {
    const client = new MockClickHouseClient([]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await expect(
      repository.lookupSubdomains({
        scope: "domains",
        filters: [
          {
            id: "filter-1",
            term: "example",
            modifier: "contains",
            include: true,
          },
        ],
        addedSince: "not-a-date",
      }),
    ).rejects.toThrow("Enter a valid addedSince date to filter discovery results.");
    expect(client.calls).toHaveLength(0);
  });

  it("rejects invalid calendar addedSince dates before querying ClickHouse", async () => {
    const client = new MockClickHouseClient([]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await expect(
      repository.lookupSubdomains({
        scope: "domains",
        filters: [
          {
            id: "filter-1",
            term: "example",
            modifier: "contains",
            include: true,
          },
        ],
        addedSince: "2026-02-31",
      }),
    ).rejects.toThrow("Enter a valid addedSince date to filter discovery results.");
    expect(client.calls).toHaveLength(0);
  });

  it("preserves the stated month for timestamp-form addedSince values", async () => {
    const client = new MockClickHouseClient([
      [
        {
          hostname: "example.com",
          apex_domain: "example.com",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await repository.lookupSubdomains({
      scope: "domains",
      filters: [
        {
          id: "filter-1",
          term: "example",
          modifier: "contains",
          include: true,
        },
      ],
      addedSince: "2026-03-01T00:30:00+14:00",
    });

    expect(client.calls[0]?.query_params).toEqual({
      addedSince: "2026-03-01",
      term_0: "%example%",
      limit: 10000,
      offset: 0,
    });
  });

  it("queries both scopes with a union across the split lookup tables", async () => {
    const client = new MockClickHouseClient([
      [
        {
          hostname: "api.example.com",
          apex_domain: "example.com",
        },
        {
          hostname: "example.com",
          apex_domain: "example.com",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.lookupSubdomains({
      scope: "both",
      filters: [
        {
          id: "filter-1",
          term: "example.com",
          modifier: "contains",
          include: true,
        },
      ],
      includeInactive: false,
      limit: 25,
      offset: 10,
    });

    expect(client.calls[0]?.query).toContain("UNION ALL");
    expect(client.calls[0]?.query).toContain("FROM tech_stack_bulk.bulk_apex_domain_lookup AS lookup");
    expect(client.calls[0]?.query).toContain("FROM tech_stack_bulk.bulk_subdomain_lookup_v2 AS lookup");
    expect(client.calls[0]?.query).toContain("lookup.domain AS hostname");
    expect(client.calls[0]?.query).toContain("lookup.domain AS apex_domain");
    expect(client.calls[0]?.query).toContain("lookup.hostname AS hostname");
    expect(client.calls[0]?.query).toContain("lookup.parent_domain = {parent_domain_0:String}");
    expect(client.calls[0]?.query).toContain("ORDER BY hostname ASC");
    expect(client.calls[0]?.query).toContain("LIMIT {limit: UInt64}");
    expect(client.calls[0]?.query).toContain("OFFSET {offset: UInt64}");
    expect(client.calls[0]?.query_params).toEqual({
      term_0: "%example.com%",
      parent_domain_0: "example.com",
      limit: 25,
      offset: 10,
    });
    expect(result).toEqual([
      {
        hostname: "api.example.com",
        apexDomain: "example.com",
      },
      {
        hostname: "example.com",
        apexDomain: "example.com",
      },
    ]);
  });

  it("checks domain existence from the split lookup tables", async () => {
    const client = new MockClickHouseClient([[{ count: "2" }]]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.checkDomainExists("example.com");

    expect(client.calls[0]?.query).toContain("FROM tech_stack_bulk.bulk_apex_domain_lookup");
    expect(client.calls[0]?.query).toContain("FROM tech_stack_bulk.bulk_subdomain_lookup_v2");
    expect(client.calls[0]?.query).toContain("UNION ALL");
    expect(client.calls[0]?.query).toContain("domain = {domain:String}");
    expect(client.calls[0]?.query).toContain("parent_domain = {domain:String}");
    expect(client.calls[0]?.query_params).toEqual({
      domain: "example.com",
    });
    expect(result).toEqual({
      exists: true,
      hostnameCount: 2,
    });
  });

  it("queries cname source hostnames for the requested cname target", async () => {
    const client = new MockClickHouseClient([
      [
        {
          hostname: "api.example.com",
          snapshot_month: "2026-04",
        },
        {
          hostname: "example.com",
          snapshot_month: "2026-04",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.lookupCnameSources({
      domain: "edge.example.net",
    });

    expect(client.calls[0]?.query).toContain("FROM bulk_active_hostname_serving");
    expect(client.calls[0]?.query).toContain("cname_target = {cname_target: String}");
    expect(client.calls[0]?.query).toContain("isNotNull(cname_target)");
    expect(client.calls[0]?.query).toContain("cname_target != ''");
    expect(client.calls[0]?.query_params).toEqual({
      cname_target: "edge.example.net",
    });
    expect(result).toEqual([
      {
        hostname: "api.example.com",
        snapshotMonth: "2026-04",
      },
      {
        hostname: "example.com",
        snapshotMonth: "2026-04",
      },
    ]);
  });

  it("ignores invalid reverse-ip limits before querying ClickHouse", async () => {
    const client = new MockClickHouseClient([
      [
        {
          hostname: "mail.example.com",
          snapshot_month: "2026-04",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await repository.lookupReverseIp({
      ip: "203.0.113.10",
      limit: Number.NaN,
    });

    expect(client.calls[0]?.query).not.toContain("LIMIT {limit: UInt64}");
    expect(client.calls[0]?.query_params).toEqual({
      ip_address: "203.0.113.10",
    });
  });

  it("ignores invalid cname lookup limits before querying ClickHouse", async () => {
    const client = new MockClickHouseClient([
      [
        {
          hostname: "api.example.com",
          snapshot_month: "2026-04",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await repository.lookupCnameSources({
      domain: "edge.example.net",
      limit: Number.NaN,
    });

    expect(client.calls[0]?.query).not.toContain("LIMIT {limit: UInt64}");
    expect(client.calls[0]?.query_params).toEqual({
      cname_target: "edge.example.net",
    });
  });

  it("normalizes invalid connected-domain limits and counts distinct multi-ip results", async () => {
    const client = new MockClickHouseClient([
      [
        { ip_address: "203.0.113.10" },
        { ip_address: "203.0.113.11" },
      ],
      [
        {
          hostname: "api.example.com",
          snapshot_month: "2026-04",
        },
      ],
      [{ total_count: "1" }],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.lookupConnectedDomains({
      domain: "example.com",
      limit: Number.NaN,
    });

    expect(client.calls[1]?.query).toContain("SELECT DISTINCT hostname, snapshot_month");
    expect(client.calls[1]?.query_params).toEqual({
      ip_0: "203.0.113.10",
      ip_1: "203.0.113.11",
      limit: 500,
    });
    expect(client.calls[2]?.query).toContain("SELECT count() AS total_count");
    expect(client.calls[2]?.query).toContain("SELECT DISTINCT hostname, snapshot_month");
    expect(client.calls[2]?.query_params).toEqual({
      ip_0: "203.0.113.10",
      ip_1: "203.0.113.11",
    });
    expect(result).toEqual({
      results: [
        {
          hostname: "api.example.com",
          snapshotMonth: "2026-04",
        },
      ],
      total: 1,
    });
  });

  it("builds infrastructure summary data from the active hostname serving view", async () => {
    const client = new MockClickHouseClient([
      [
        {
          snapshot_month: "2026-04",
          hostname_count: "3",
          ip_address_count: "2",
          cname_count: "1",
          provider_count: "2",
        },
      ],
      [
        { provider_hint: "Cloudflare", provider_count: "2" },
        { provider_hint: "Fastly", provider_count: "1" },
      ],
      [{ cname_target: "edge.example.net", cname_count: "1" }],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.lookupInfrastructureSummary({
      domain: "example.com",
    });

    expect(client.calls).toHaveLength(3);
    expect(client.calls[0]?.query).toContain("FROM bulk_active_hostname_serving");
    expect(client.calls[1]?.query).toContain("provider_hint");
    expect(client.calls[2]?.query).toContain("cname_target");
    expect(result).toEqual({
      snapshotMonth: "2026-04",
      totals: {
        hostnames: 3,
        ipAddresses: 2,
        cnames: 1,
        providers: 2,
      },
      providers: [
        { provider: "Cloudflare", count: 2 },
        { provider: "Fastly", count: 1 },
      ],
      cnameTargets: [{ target: "edge.example.net", count: 1 }],
    });
  });

  it("detects whether active bulk data includes cname targets", async () => {
    const client = new MockClickHouseClient([[{ has_cname_data: 1 }]]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await expect(repository.hasBulkCnameSupport()).resolves.toBe(true);
    expect(client.calls[0]?.query).toContain("FROM bulk_active_hostname_serving");
  });

  it("queries CT alert summary counters from the active alert feed", async () => {
    const client = new MockClickHouseClient([
      [
        {
          newest_dump_date: "2026-05-18",
          alert_count: "12",
          phishing_count: "5",
          brand_protection_count: "4",
          shadow_it_count: "3",
          high_severity_count: "7",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await expect(repository.lookupCtAlertSummary()).resolves.toEqual({
      newestDumpDate: "2026-05-18",
      totals: {
        alerts: 12,
        phishing: 5,
        brandProtection: 4,
        shadowIt: 3,
        highSeverity: 7,
      },
    });
    expect(client.calls[0]?.query).toContain("FROM ct_active_alert_feed");
  });

  it("queries filtered CT alert rows and total counts", async () => {
    const client = new MockClickHouseClient([
      [
        {
          alert_id: "alert-1",
          dump_date: "2026-05-18",
          domain: "secure-openai-login.net",
          category: "phishing",
          severity: "high",
          watch_type: "brand",
          matched_term: "openai",
          reasons: ["contains watched brand term", "contains risky login keyword"],
          issuer_name: "Let's Encrypt",
        },
      ],
      [{ total_count: "51" }],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await expect(
      repository.lookupCtAlerts({
        limit: 25,
        offset: 50,
        category: "phishing",
        severity: "high",
        watchType: "brand",
        dumpDate: "2026-05-18",
      }),
    ).resolves.toEqual({
      results: [
        {
          id: "alert-1",
          observedAt: "2026-05-18",
          domain: "secure-openai-login.net",
          category: "phishing",
          severity: "high",
          watchType: "brand",
          matchedTerm: "openai",
          reasons: ["contains watched brand term", "contains risky login keyword"],
          issuerName: "Let's Encrypt",
        },
      ],
      total: 51,
    });
    expect(client.calls[0]?.query).toContain("FROM ct_active_alert_feed");
    expect(client.calls[0]?.query).toContain("category = {category: String}");
    expect(client.calls[0]?.query_params).toEqual({
      category: "phishing",
      severity: "high",
      watch_type: "brand",
      dump_date: "2026-05-18",
      limit: 25,
      offset: 50,
    });
  });

  it("lists CT watchlist entries from the latest replaced rows", async () => {
    const client = new MockClickHouseClient([
      [
        {
          entry_id_text: "019e3aaf-eb6a-78ce-a523-7f4c9dfa61ff",
          watch_type: "brand",
          term: "openai",
          enabled: 1,
          created_at: "2026-05-18 06:00:00",
          updated_at: "2026-05-18 07:00:00",
          created_by: "admin",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await expect(repository.listCtWatchlistEntries()).resolves.toEqual([
      {
        entryId: "019e3aaf-eb6a-78ce-a523-7f4c9dfa61ff",
        watchType: "brand",
        term: "openai",
        enabled: true,
        createdAt: "2026-05-18 06:00:00",
        updatedAt: "2026-05-18 07:00:00",
        createdBy: "admin",
      },
    ]);
    expect(client.calls[0]?.query).toContain("FROM ct_watchlist_entry FINAL");
  });

  it("creates CT watchlist entries with generated ids and ownership metadata", async () => {
    const client = new MockClickHouseClient([]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.createCtWatchlistEntry({
      watchType: "brand",
      term: "openai",
      enabled: true,
      createdBy: "admin",
    });

    expect(result.watchType).toBe("brand");
    expect(result.term).toBe("openai");
    expect(result.enabled).toBe(true);
    expect(result.createdBy).toBe("admin");
    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0]?.table).toBe("ct_watchlist_entry");
    expect(client.inserts[0]?.values[0]).toMatchObject({
      watch_type: "brand",
      term: "openai",
      enabled: true,
      created_by: "admin",
    });
    expect(client.inserts[0]?.values[0]?.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/,
    );
  });

  it("deletes owned CT watchlist entries after looking them up by UUID", async () => {
    const client = new MockClickHouseClient([
      [
        {
          entry_id_text: "14ffb093-26ce-4b8f-b5b8-e4bd65ffbb9b",
          watch_type: "keyword",
          term: "codex-verify",
          enabled: 1,
          created_by: "admin",
          created_at: "2026-05-26 06:59:40.216",
          updated_at: "2026-05-26 06:59:40.216",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    await expect(
      repository.deleteCtWatchlistEntry("14ffb093-26ce-4b8f-b5b8-e4bd65ffbb9b", "admin"),
    ).resolves.toBe(true);
    expect(client.calls[0]?.query).toContain("AS entry_id_text");
    expect(client.commands[1]?.query).toContain("DELETE WHERE entry_id = toUUID");
  });
});
