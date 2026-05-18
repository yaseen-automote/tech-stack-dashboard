import { GET } from "@/app/api/alerts/route";

describe("GET /api/alerts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proxies CT alert filters to the bulk API and preserves the payload", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
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
          },
        ],
        pagination: {
          limit: 25,
          offset: 0,
          total: 1,
        },
        source: "bulk",
      }),
    );

    const request = new Request(
      "http://localhost:3000/api/alerts?category=phishing&severity=high&limit=25",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/v1/ct/alerts?category=phishing&severity=high&limit=25"),
      expect.objectContaining({
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      }),
    );
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
        },
      ],
      pagination: {
        limit: 25,
        offset: 0,
        total: 1,
      },
      source: "bulk",
    });
  });

  it("preserves CT alert validation errors from the bulk API", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({ error: "Select a valid CT alert category." }, { status: 400 }),
    );

    const response = await GET(new Request("http://localhost:3000/api/alerts?category=noise"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Select a valid CT alert category.",
    });
  });
});
