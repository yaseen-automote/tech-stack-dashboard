// @vitest-environment node

import { createBulkApiLookupService } from "./service";
import type { BulkApiConfig } from "./config";
import type { BulkApiRepository } from "./repository";

function buildConfig(overrides: Partial<BulkApiConfig> = {}): BulkApiConfig {
  return {
    snapshotStoragePath: "C:/bulk/snapshots",
    activeSnapshotMonth: "2026-04",
    clickhouse: {
      host: "localhost",
      port: 8123,
      database: "default",
      user: "default",
      password: "secret",
    },
    hono: {
      host: "127.0.0.1",
      port: 8787,
    },
    thc: {
      baseUrl: "https://ip.thc.org",
      apiKey: "secret-key",
    },
    ...overrides,
  };
}

function buildRepository(): BulkApiRepository {
  return {
    lookupReverseIp: vi.fn(),
    lookupSubdomains: vi.fn(),
    lookupCnameSources: vi.fn(),
    hasBulkCnameSupport: vi.fn(),
    lookupInfrastructureSummary: vi.fn(),
  };
}

describe("createBulkApiLookupService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps ClickHouse reverse-ip rows into dashboard-ready records", async () => {
    const repository = buildRepository();
    vi.mocked(repository.lookupReverseIp).mockResolvedValue([
      { hostname: "sea30s10-in-f14.1e100.net", snapshotMonth: "2026-04" },
      { hostname: "lga34s40-in-f14.1e100.net", snapshotMonth: "2026-04" },
    ]);
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    const response = await service.lookupReverseIp({
      ip: "142.251.43.46",
      limit: 10,
    });

    expect(response).toEqual({
      domain: "142.251.43.46",
      results: [
        {
          id: "sea30s10-in-f14.1e100.net-0",
          subdomain: "sea30s10-in-f14.1e100.net",
          type: "Reverse DNS",
          status: "Live",
        },
        {
          id: "lga34s40-in-f14.1e100.net-1",
          subdomain: "lga34s40-in-f14.1e100.net",
          type: "Reverse DNS",
          status: "Live",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });
  });

  it("classifies bulk subdomain rows with the existing dashboard heuristics", async () => {
    const repository = buildRepository();
    vi.mocked(repository.lookupSubdomains).mockResolvedValue([
      { hostname: "example.com", snapshotMonth: "2026-04" },
      { hostname: "api.example.com", snapshotMonth: "2026-04" },
      { hostname: "staging.example.com", snapshotMonth: "2026-04" },
    ]);
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    const response = await service.lookupSubdomains({
      domain: "example.com",
      limit: 10,
    });

    expect(response).toEqual({
      domain: "example.com",
      results: [
        {
          id: "example.com-0",
          subdomain: "example.com",
          type: "Apex",
          status: "Primary",
        },
        {
          id: "api.example.com-1",
          subdomain: "api.example.com",
          type: "Application",
          status: "Live",
        },
        {
          id: "staging.example.com-2",
          subdomain: "staging.example.com",
          type: "Environment",
          status: "Review",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });
  });

  it("uses bulk cname rows when the active dataset supports cname targets", async () => {
    const repository = buildRepository();
    vi.mocked(repository.hasBulkCnameSupport).mockResolvedValue(true);
    vi.mocked(repository.lookupCnameSources).mockResolvedValue([
      { hostname: "www.phrack.org", snapshotMonth: "2026-04" },
      { hostname: "phrack.com", snapshotMonth: "2026-04" },
    ]);
    const fetchSpy = vi.fn();
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: fetchSpy,
    });

    const response = await service.lookupCnames({
      domain: "phrack.org",
      limit: 10,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response).toEqual({
      domain: "phrack.org",
      results: [
        {
          id: "www.phrack.org-0",
          subdomain: "www.phrack.org",
          type: "CNAME",
          status: "Live",
        },
        {
          id: "phrack.com-1",
          subdomain: "phrack.com",
          type: "CNAME",
          status: "Live",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });
  });

  it("falls back to the thc cname API when the bulk dataset cannot support cname lookups", async () => {
    const repository = buildRepository();
    vi.mocked(repository.hasBulkCnameSupport).mockResolvedValue(false);
    const fetchSpy = vi.fn().mockResolvedValue(
      Response.json({
        results: ["www.phrack.org", "phrack.com", "cdn.phrack.org"],
      }),
    );
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: fetchSpy,
    });

    const response = await service.lookupCnames({
      domain: "phrack.org",
      limit: 2,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [upstreamUrl, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(upstreamUrl)).toBe("https://ip.thc.org/api/v1/lookup/cnames");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain",
        "Content-Type": "application/json",
        Authorization: "Bearer secret-key",
      },
      body: JSON.stringify({
        target_domain: "phrack.org",
      }),
    });
    expect(response).toEqual({
      domain: "phrack.org",
      results: [
        {
          id: "www.phrack.org-0",
          subdomain: "www.phrack.org",
          type: "CNAME",
          status: "Live",
        },
        {
          id: "phrack.com-1",
          subdomain: "phrack.com",
          type: "CNAME",
          status: "Live",
        },
      ],
      source: "upstream",
    });
  });

  it("returns infrastructure summary metadata from ClickHouse", async () => {
    const repository = buildRepository();
    vi.mocked(repository.lookupInfrastructureSummary).mockResolvedValue({
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
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    const response = await service.lookupInfrastructureSummary({
      domain: "example.com",
    });

    expect(response).toEqual({
      domain: "example.com",
      snapshotMonth: "2026-04",
      source: "bulk",
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
});
