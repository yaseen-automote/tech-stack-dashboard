// @vitest-environment node

import { Hono } from "hono";

import { createBulkApiApp } from "./app";
import type { BulkApiConfig } from "./config";
import type {
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
      domain: "example.com",
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

    const response = await request(app, "/v1/subdomains?domain=EXAMPLE.com&limit=5");

    expect(lookupService.lookupSubdomains).toHaveBeenCalledWith({
      domain: "example.com",
      limit: 5,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      domain: "example.com",
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

    const response = await request(app, "/v1/cnames?domain=phrack.org&limit=15");

    expect(lookupService.lookupCnames).toHaveBeenCalledWith({
      domain: "phrack.org",
      limit: 15,
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
});
