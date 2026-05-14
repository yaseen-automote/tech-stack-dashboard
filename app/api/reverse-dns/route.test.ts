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

  it("posts the ip_address payload to the upstream API and maps JSON results", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        results: ["sea30s10-in-f14.1e100.net", "lga34s40-in-f14.1e100.net"],
      }),
    );

    const request = new Request("http://localhost:3000/api/reverse-dns?ip=142.251.43.46");
    const response = await GET(request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [upstreamUrl, init] = fetchSpy.mock.calls[0] ?? [];

    expect(String(upstreamUrl)).toBe("https://ip.thc.org/api/v1/lookup");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ip_address: "142.251.43.46",
        tld: ["com"],
        apex_domain: "",
        page_state: "",
        limit: 10,
      }),
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
    });
  });
});
