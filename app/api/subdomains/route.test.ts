import { GET } from "@/app/api/subdomains/route";

describe("GET /api/subdomains", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid domains before calling the upstream service", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const request = new Request("http://localhost:3000/api/subdomains?domain=invalid domain");

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Enter a valid domain to inspect subdomain infrastructure.",
    });
  });

  it("proxies valid requests to the bulk subdomains API and preserves the payload", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
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
      }),
    );

    const request = new Request("http://localhost:3000/api/subdomains?domain=example.com");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/v1/subdomains?domain=example.com&limit=100"),
      expect.objectContaining({
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      }),
    );
    await expect(response.json()).resolves.toEqual({
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

  it("returns a 502 when the bulk subdomains API responds with an error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json(
        { error: "bulk backend unavailable" },
        { status: 503 },
      ),
    );

    const request = new Request("http://localhost:3000/api/subdomains?domain=google.com");
    const response = await GET(request);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "bulk backend unavailable",
    });
  });
});
