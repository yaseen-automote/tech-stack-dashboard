// @vitest-environment node

import { Hono } from "hono";

import { createBulkApiApp } from "./app";
import type { BulkApiConfig } from "./config";
import type {
  BulkCtAlertFeedResponse,
  BulkCtAlertSummaryResponse,
  BulkCtWatchlistMutationResponse,
  BulkCtWatchlistResponse,
  BulkApiLookupService,
  BulkCnameLookupResponse,
  BulkInfrastructureSummaryResponse,
  BulkReverseIpLookupResponse,
  BulkSubdomainLookupResponse,
} from "./service";

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
      apiKey: undefined,
    },
    ...overrides,
  };
}

function buildLookupService(): BulkApiLookupService {
  return {
    lookupReverseIp: vi.fn<() => Promise<BulkReverseIpLookupResponse>>(),
    lookupSubdomains: vi.fn<() => Promise<BulkSubdomainLookupResponse>>(),
    lookupCnames: vi.fn<() => Promise<BulkCnameLookupResponse>>(),
    lookupInfrastructureSummary: vi.fn<() => Promise<BulkInfrastructureSummaryResponse>>(),
    lookupCtAlertSummary: vi.fn<() => Promise<BulkCtAlertSummaryResponse>>(),
    lookupCtAlerts: vi.fn<() => Promise<BulkCtAlertFeedResponse>>(),
    listCtWatchlistEntries: vi.fn<() => Promise<BulkCtWatchlistResponse>>(),
    createCtWatchlistEntry: vi.fn<() => Promise<BulkCtWatchlistMutationResponse>>(),
    updateCtWatchlistEntry: vi.fn<
      () => Promise<BulkCtWatchlistMutationResponse | null>
    >(),
    deleteCtWatchlistEntry: vi.fn<() => Promise<boolean>>(),
  };
}

async function request(app: Hono, path: string) {
  return app.request(`http://localhost${path}`);
}

describe("createBulkApiApp", () => {
  it("returns health metadata for the active bulk snapshot", async () => {
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService: buildLookupService(),
    });

    const response = await request(app, "/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "bulk-api",
      activeSnapshotMonth: "2026-04",
    });
  });

  it("rejects invalid reverse-ip requests before invoking the lookup service", async () => {
    const lookupService = buildLookupService();
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(app, "/v1/reverse-ip?ip=not-an-ip");

    expect(response.status).toBe(400);
    expect(lookupService.lookupReverseIp).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Enter a valid IP address to inspect reverse DNS records.",
    });
  });

  it("passes reverse-ip requests through to the lookup service", async () => {
    const lookupService = buildLookupService();
    vi.mocked(lookupService.lookupReverseIp).mockResolvedValue({
      domain: "142.251.43.46",
      results: [
        {
          id: "sea30s10-in-f14.1e100.net-0",
          subdomain: "sea30s10-in-f14.1e100.net",
          type: "Reverse DNS",
          status: "Live",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });

    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(app, "/v1/reverse-ip?ip=142.251.43.46&limit=25");

    expect(lookupService.lookupReverseIp).toHaveBeenCalledWith({
      ip: "142.251.43.46",
      limit: 25,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      domain: "142.251.43.46",
      results: [
        {
          id: "sea30s10-in-f14.1e100.net-0",
          subdomain: "sea30s10-in-f14.1e100.net",
          type: "Reverse DNS",
          status: "Live",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });
  });

  it("passes subdomain requests through to the lookup service", async () => {
    const lookupService = buildLookupService();
    vi.mocked(lookupService.lookupSubdomains).mockResolvedValue({
      domain: "Domains & Subdomains Discovery",
      results: [
        {
          id: "api.example.com-0",
          subdomain: "api.example.com",
          type: "Application",
          status: "Live",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });

    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(
      app,
      "/v1/subdomains?scope=both&domainTerm=EXAMPLE*&domainModifier=starts_with&subdomainTerm=api&subdomainModifier=contains&limit=bogus",
    );

    expect(lookupService.lookupSubdomains).toHaveBeenCalledWith({
      scope: "both",
      domainTerm: "example*",
      domainModifier: "starts_with",
      subdomainTerm: "api",
      subdomainModifier: "contains",
      limit: 100,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      domain: "Domains & Subdomains Discovery",
      results: [
        {
          id: "api.example.com-0",
          subdomain: "api.example.com",
          type: "Application",
          status: "Live",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });
  });

  it("rejects subdomain searches without any effective predicates", async () => {
    const lookupService = buildLookupService();
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(app, "/v1/subdomains?scope=domains");

    expect(response.status).toBe(400);
    expect(lookupService.lookupSubdomains).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Enter at least one domain or subdomain search term to inspect subdomain infrastructure.",
    });
  });

  it("rejects invalid domain modifiers before invoking the lookup service", async () => {
    const lookupService = buildLookupService();
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(
      app,
      "/v1/subdomains?scope=domains&domainTerm=example&domainModifier=equals",
    );

    expect(response.status).toBe(400);
    expect(lookupService.lookupSubdomains).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Select a valid domain search modifier.",
    });
  });

  it("rejects raw SQL wildcard characters before invoking the lookup service", async () => {
    const lookupService = buildLookupService();
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(
      app,
      "/v1/subdomains?scope=both&subdomainTerm=api_internal&subdomainModifier=contains",
    );

    expect(response.status).toBe(400);
    expect(lookupService.lookupSubdomains).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Use * as the only wildcard in domain and subdomain search terms.",
    });
  });

  it("passes cname requests through to the lookup service", async () => {
    const lookupService = buildLookupService();
    vi.mocked(lookupService.lookupCnames).mockResolvedValue({
      domain: "phrack.org",
      results: [
        {
          id: "www.phrack.org-0",
          subdomain: "www.phrack.org",
          type: "CNAME",
          status: "Live",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });

    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(app, "/v1/cnames?domain=phrack.org");

    expect(lookupService.lookupCnames).toHaveBeenCalledWith({
      domain: "phrack.org",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      domain: "phrack.org",
      results: [
        {
          id: "www.phrack.org-0",
          subdomain: "www.phrack.org",
          type: "CNAME",
          status: "Live",
        },
      ],
      snapshotMonth: "2026-04",
      source: "bulk",
    });
  });

  it("passes infrastructure summary requests through to the lookup service", async () => {
    const lookupService = buildLookupService();
    vi.mocked(lookupService.lookupInfrastructureSummary).mockResolvedValue({
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

    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(app, "/v1/infrastructure/summary?domain=example.com");

    expect(lookupService.lookupInfrastructureSummary).toHaveBeenCalledWith({
      domain: "example.com",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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

  it("passes CT alert feed filters through to the lookup service", async () => {
    const lookupService = buildLookupService();
    vi.mocked(lookupService.lookupCtAlerts).mockResolvedValue({
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
        total: 51,
      },
      source: "bulk",
    });
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(
      app,
      "/v1/ct/alerts?category=phishing&severity=high&watchType=brand&dumpDate=2026-05-18&limit=25&offset=50",
    );

    expect(lookupService.lookupCtAlerts).toHaveBeenCalledWith({
      category: "phishing",
      severity: "high",
      watchType: "brand",
      dumpDate: "2026-05-18",
      limit: 25,
      offset: 50,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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
        total: 51,
      },
      source: "bulk",
    });
  });

  it("rejects invalid CT alert category filters before invoking the lookup service", async () => {
    const lookupService = buildLookupService();
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(app, "/v1/ct/alerts?category=noise");

    expect(response.status).toBe(400);
    expect(lookupService.lookupCtAlerts).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Select a valid CT alert category.",
    });
  });

  it("returns CT alert summary metadata", async () => {
    const lookupService = buildLookupService();
    vi.mocked(lookupService.lookupCtAlertSummary).mockResolvedValue({
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
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await request(app, "/v1/ct/alerts/summary");

    expect(response.status).toBe(200);
    expect(lookupService.lookupCtAlertSummary).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
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

  it("creates CT watchlist entries", async () => {
    const lookupService = buildLookupService();
    vi.mocked(lookupService.createCtWatchlistEntry).mockResolvedValue({
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
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await app.request("http://localhost/v1/ct/watchlists", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        watchType: "brand",
        term: "OpenAI",
        enabled: true,
      }),
    });

    expect(response.status).toBe(201);
    expect(lookupService.createCtWatchlistEntry).toHaveBeenCalledWith({
      watchType: "brand",
      term: "OpenAI",
      enabled: true,
    });
  });

  it("updates CT watchlist entries", async () => {
    const lookupService = buildLookupService();
    vi.mocked(lookupService.updateCtWatchlistEntry).mockResolvedValue({
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
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await app.request(
      "http://localhost/v1/ct/watchlists/3f8ea328-7f4f-4476-9ad4-a80b426fd444",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          term: "ChatGPT",
          enabled: false,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(lookupService.updateCtWatchlistEntry).toHaveBeenCalledWith({
      entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
      term: "ChatGPT",
      enabled: false,
    });
  });

  it("deletes CT watchlist entries", async () => {
    const lookupService = buildLookupService();
    vi.mocked(lookupService.deleteCtWatchlistEntry).mockResolvedValue(true);
    const app = createBulkApiApp({
      config: buildConfig(),
      lookupService,
    });

    const response = await app.request(
      "http://localhost/v1/ct/watchlists/3f8ea328-7f4f-4476-9ad4-a80b426fd444",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(200);
    expect(lookupService.deleteCtWatchlistEntry).toHaveBeenCalledWith(
      "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
    });
  });
});
