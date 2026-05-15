import { GET } from "@/app/api/reverse-dns/route";

describe("GET /api/reverse-dns", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid IP addresses before calling the upstream service", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const request = new Request("http://localhost:3000/api/reverse-dns?ip=not-an-ip");

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Enter a valid IP address to inspect reverse DNS records.",
    });
  });

  it("proxies valid requests to the bulk reverse-ip API and preserves the payload", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        domain: "142.251.43.46",
        results: ["sea30s10-in-f14.1e100.net", "lga34s40-in-f14.1e100.net"].map(
          (subdomain, index) => ({
            id: `${subdomain}-${index}`,
            subdomain,
            type: "Reverse DNS",
            status: "Live",
          }),
        ),
        snapshotMonth: "2026-04",
        source: "bulk",
      }),
    );

    const request = new Request("http://localhost:3000/api/reverse-dns?ip=142.251.43.46");
    const response = await GET(request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [upstreamUrl, init] = fetchSpy.mock.calls[0] ?? [];

    expect(String(upstreamUrl)).toBe("http://127.0.0.1:8787/v1/reverse-ip?ip=142.251.43.46&limit=10");
    expect(init).toMatchObject({
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
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
});
