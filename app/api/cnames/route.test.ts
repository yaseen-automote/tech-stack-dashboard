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

  it("posts the target_domain payload to the upstream API and maps JSON results", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        results: ["www.phrack.org", "phrack.com"],
      }),
    );

    const request = new Request("http://localhost:3000/api/cnames?domain=phrack.org");
    const response = await GET(request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [upstreamUrl, init] = fetchSpy.mock.calls[0] ?? [];

    expect(String(upstreamUrl)).toBe("https://ip.thc.org/api/v1/lookup/cnames");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target_domain: "phrack.org",
      }),
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
    });
  });
});
