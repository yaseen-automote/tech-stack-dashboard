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
    lookupCtAlertSummary: vi.fn(),
    lookupCtAlerts: vi.fn(),
    listCtWatchlistEntries: vi.fn(),
    createCtWatchlistEntry: vi.fn(),
    updateCtWatchlistEntry: vi.fn(),
    deleteCtWatchlistEntry: vi.fn(),
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
      { hostname: "example.com", apexDomain: "example.com", snapshotMonth: "2026-04" },
      { hostname: "api.example.com", apexDomain: "example.com", snapshotMonth: "2026-04" },
      { hostname: "staging.example.org", apexDomain: "example.org", snapshotMonth: "2026-04" },
    ]);
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    const response = await service.lookupSubdomains({
      scope: "both",
      domainTerm: "example",
      domainModifier: "contains",
      limit: 10,
    });

    expect(response).toEqual({
      domain: "Domains & Subdomains Discovery",
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
          id: "staging.example.org-2",
          subdomain: "staging.example.org",
          type: "Environment",
          status: "Review",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });
    expect(repository.lookupSubdomains).toHaveBeenCalledWith({
      scope: "both",
      domainTerm: "example",
      domainModifier: "contains",
      limit: 10,
    });
  });

  it("rejects raw SQL wildcard characters consistently before hitting the repository", async () => {
    const repository = buildRepository();
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    await expect(
      service.lookupSubdomains({
        scope: "both",
        domainTerm: "exa%mple",
        domainModifier: "contains",
        limit: 100,
      }),
    ).rejects.toThrow("Use * as the only wildcard in domain and subdomain search terms.");
    expect(repository.lookupSubdomains).not.toHaveBeenCalled();
  });

  it("uses bulk cname rows that point at the requested cname target", async () => {
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
      domain: "edge.example.net",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(repository.lookupCnameSources).toHaveBeenCalledWith({
      domain: "edge.example.net",
    });
    expect(response).toEqual({
      domain: "edge.example.net",
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
        {
          id: "cdn.phrack.org-2",
          subdomain: "cdn.phrack.org",
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

  it("returns CT alert summary counters from ClickHouse", async () => {
    const repository = buildRepository();
    vi.mocked(repository.lookupCtAlertSummary).mockResolvedValue({
      newestDumpDate: "2026-05-18",
      totals: {
        alerts: 12,
        phishing: 5,
        brandProtection: 4,
        shadowIt: 3,
        highSeverity: 7,
      },
    });
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    await expect(service.lookupCtAlertSummary()).resolves.toEqual({
      newestDumpDate: "2026-05-18",
      totals: {
        alerts: 12,
        phishing: 5,
        brandProtection: 4,
        shadowIt: 3,
        highSeverity: 7,
      },
      source: "bulk",
    });
  });

  it("returns filtered CT alert feed data with pagination metadata", async () => {
    const repository = buildRepository();
    vi.mocked(repository.lookupCtAlerts).mockResolvedValue({
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
      total: 1,
    });
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    const response = await service.lookupCtAlerts({
      limit: 25,
      offset: 50,
      category: "phishing",
      severity: "high",
      watchType: "brand",
      dumpDate: "2026-05-18",
    });

    expect(repository.lookupCtAlerts).toHaveBeenCalledWith({
      limit: 25,
      offset: 50,
      category: "phishing",
      severity: "high",
      watchType: "brand",
      dumpDate: "2026-05-18",
    });
    expect(response).toEqual({
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
      pagination: {
        limit: 25,
        offset: 50,
        total: 1,
      },
      source: "bulk",
    });
  });

  it("normalizes CT watchlist terms before creating entries", async () => {
    const repository = buildRepository();
    vi.mocked(repository.createCtWatchlistEntry).mockResolvedValue({
      entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
      watchType: "brand",
      term: "openai",
      enabled: true,
      createdAt: "2026-05-18T06:00:00.000Z",
      updatedAt: "2026-05-18T06:00:00.000Z",
    });
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    const response = await service.createCtWatchlistEntry({
      watchType: "brand",
      term: " OpenAI ",
      enabled: true,
    });

    expect(repository.createCtWatchlistEntry).toHaveBeenCalledWith({
      watchType: "brand",
      term: "openai",
      enabled: true,
    });
    expect(response).toEqual({
      entry: {
        entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
        watchType: "brand",
        term: "openai",
        enabled: true,
        createdAt: "2026-05-18T06:00:00.000Z",
        updatedAt: "2026-05-18T06:00:00.000Z",
      },
      source: "bulk",
    });
  });

  it("normalizes CT watchlist terms before updating entries", async () => {
    const repository = buildRepository();
    vi.mocked(repository.updateCtWatchlistEntry).mockResolvedValue({
      entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
      watchType: "brand",
      term: "chatgpt",
      enabled: false,
      createdAt: "2026-05-18T06:00:00.000Z",
      updatedAt: "2026-05-18T07:00:00.000Z",
    });
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    const response = await service.updateCtWatchlistEntry({
      entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
      term: " ChatGPT ",
      enabled: false,
    });

    expect(repository.updateCtWatchlistEntry).toHaveBeenCalledWith({
      entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
      term: "chatgpt",
      enabled: false,
    });
    expect(response).toEqual({
      entry: {
        entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
        watchType: "brand",
        term: "chatgpt",
        enabled: false,
        createdAt: "2026-05-18T06:00:00.000Z",
        updatedAt: "2026-05-18T07:00:00.000Z",
      },
      source: "bulk",
    });
  });

  it("passes CT watchlist delete requests through to the repository", async () => {
    const repository = buildRepository();
    vi.mocked(repository.deleteCtWatchlistEntry).mockResolvedValue(true);
    const service = createBulkApiLookupService({
      config: buildConfig(),
      repository,
      fetch: vi.fn(),
    });

    await expect(
      service.deleteCtWatchlistEntry("3f8ea328-7f4f-4476-9ad4-a80b426fd444"),
    ).resolves.toBe(true);
    expect(repository.deleteCtWatchlistEntry).toHaveBeenCalledWith(
      "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
    );
  });
});
