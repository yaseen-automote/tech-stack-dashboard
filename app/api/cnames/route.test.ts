import { GET } from "@/app/api/cnames/route";

describe("GET /api/cnames", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid domains before calling the upstream service", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const request = new Request("http://localhost:3000/api/cnames?domain=invalid domain");

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Enter a valid domain to inspect CNAME records.",
    });
  });

  it("proxies valid requests to the bulk cname API and preserves the payload", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
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
      }),
    );

    const request = new Request("http://localhost:3000/api/cnames?domain=phrack.org");
    const response = await GET(request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [upstreamUrl, init] = fetchSpy.mock.calls[0] ?? [];

    expect(String(upstreamUrl)).toBe("http://127.0.0.1:8787/v1/cnames?domain=phrack.org&limit=25");
    expect(init).toMatchObject({
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
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
});
