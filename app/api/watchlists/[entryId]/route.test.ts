import { DELETE, PATCH } from "@/app/api/watchlists/[entryId]/route";

describe("CT watchlist entry routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proxies CT watchlist updates", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        entry: {
          entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
          watchType: "brand",
          term: "chatgpt",
          enabled: false,
        },
        source: "bulk",
      }),
    );

    const response = await PATCH(
      new Request("http://localhost:3000/api/watchlists/3f8ea328-7f4f-4476-9ad4-a80b426fd444", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          term: "ChatGPT",
          enabled: false,
        }),
      }),
      {
        params: Promise.resolve({
          entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/v1/ct/watchlists/3f8ea328-7f4f-4476-9ad4-a80b426fd444"),
      expect.objectContaining({
        method: "PATCH",
        cache: "no-store",
      }),
    );
  });

  it("preserves CT watchlist not-found errors on delete", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({ error: "The CT watchlist entry was not found." }, { status: 404 }),
    );

    const response = await DELETE(new Request("http://localhost:3000/api/watchlists/test"), {
      params: Promise.resolve({
        entryId: "test",
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "The CT watchlist entry was not found.",
    });
  });
});
