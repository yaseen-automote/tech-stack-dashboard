import { GET, POST } from "@/app/api/watchlists/route";

describe("CT watchlist collection routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proxies CT watchlist reads", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        entries: [
          {
            entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
            watchType: "brand",
            term: "openai",
            enabled: true,
          },
        ],
        source: "bulk",
      }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/v1/ct/watchlists"),
      expect.objectContaining({
        cache: "no-store",
      }),
    );
  });

  it("proxies CT watchlist creation and preserves client errors", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({ error: "Enter a CT watchlist term to monitor." }, { status: 400 }),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/watchlists", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          watchType: "brand",
          term: "",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Enter a CT watchlist term to monitor.",
    });
  });
});
