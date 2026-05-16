// @vitest-environment node

import { readFile } from "node:fs/promises";

import { ClickHouseBulkApiRepository } from "./repository";

type QueryCall = {
  query: string;
  query_params?: Record<string, unknown>;
  format?: string;
};

class MockClickHouseClient {
  readonly calls: QueryCall[] = [];
  private readonly responses: Array<Record<string, unknown>[]>;

  constructor(responses: Array<Record<string, unknown>[]>) {
    this.responses = [...responses];
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
    if (!call.query.includes("FROM bulk_active_hostname_serving")) {
      throw new Error("Test helper only supports active hostname serving queries.");
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

    expect(client.calls[0]?.query).toContain("FROM bulk_active_hostname_serving");
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

  it("queries the active subdomain serving view", async () => {
    const client = new MockClickHouseClient([
      [
        {
          hostname: "api.example.com",
          snapshot_month: "2026-04",
        },
      ],
    ]);
    const repository = new ClickHouseBulkApiRepository({ client });

    const result = await repository.lookupSubdomains({
      domain: "example.com",
      limit: 50,
    });

    expect(client.calls[0]?.query).toContain("FROM bulk_active_hostname_serving");
    expect(client.calls[0]?.query_params).toEqual({
      apex_domain: "example.com",
      limit: 50,
    });
    expect(result).toEqual([
      {
        hostname: "api.example.com",
        snapshotMonth: "2026-04",
      },
    ]);
  });

  it("queries cname source hostnames under the requested apex domain", async () => {
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
      domain: "example.com",
      limit: 25,
    });

    expect(client.calls[0]?.query).toContain("FROM bulk_active_hostname_serving");
    expect(client.calls[0]?.query).toContain("apex_domain = {apex_domain: String}");
    expect(client.calls[0]?.query).toContain("isNotNull(cname_target)");
    expect(client.calls[0]?.query).toContain("cname_target != ''");
    expect(client.calls[0]?.query_params).toEqual({
      apex_domain: "example.com",
      limit: 25,
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
});
