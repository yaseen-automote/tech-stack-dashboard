import { GET } from "@/app/api/alerts/summary/route";

describe("GET /api/alerts/summary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proxies CT alert summary metadata from the bulk API", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        newestDumpDate: "2026-05-18",
        totals: {
          alerts: 12,
          phishing: 5,
          brandProtection: 4,
          shadowIt: 3,
          highSeverity: 7,
        },
        source: "bulk",
      }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/v1/ct/alerts/summary"),
      expect.objectContaining({
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      }),
    );
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
});
