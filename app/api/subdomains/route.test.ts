import { GET } from "@/app/api/subdomains/route";

describe("GET /api/subdomains", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects requests that do not contain any effective domain or subdomain predicates", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const request = new Request("http://localhost:3000/api/subdomains?scope=both");

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Enter at least one domain or subdomain search term to inspect subdomain infrastructure.",
    });
  });

  it("rejects invalid subdomain modifiers before calling the upstream service", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const request = new Request(
      "http://localhost:3000/api/subdomains?scope=subdomains&subdomainTerm=api&subdomainModifier=equals",
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Select a valid subdomain search modifier.",
    });
  });

  it("rejects raw SQL wildcard characters before calling the upstream service", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const request = new Request(
      "http://localhost:3000/api/subdomains?scope=both&domainTerm=exa%mple&domainModifier=contains",
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Use * as the only wildcard in domain and subdomain search terms.",
    });
  });

  it("proxies modular search requests to the bulk subdomains API and preserves the payload", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
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
            id: "staging.example.com-2",
            subdomain: "staging.example.com",
            type: "Environment",
            status: "Review",
          },
        ],
        snapshotMonth: "2026-04",
        source: "bulk",
      }),
    );

    const request = new Request(
      "http://localhost:3000/api/subdomains?scope=both&domainTerm=Example*&domainModifier=starts_with&subdomainTerm=api&subdomainModifier=contains&limit=invalid",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      new URL(
        "http://127.0.0.1:8787/v1/subdomains?scope=both&domainTerm=example*&domainModifier=starts_with&subdomainTerm=api&subdomainModifier=contains&limit=100",
      ),
      expect.objectContaining({
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      }),
    );
    await expect(response.json()).resolves.toEqual({
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

  it("returns a 502 when the bulk subdomains API responds with an error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json(
        { error: "bulk backend unavailable" },
        { status: 503 },
      ),
    );

    const request = new Request(
      "http://localhost:3000/api/subdomains?scope=domains&domainTerm=google.com&domainModifier=contains",
    );
    const response = await GET(request);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "bulk backend unavailable",
    });
  });
});
