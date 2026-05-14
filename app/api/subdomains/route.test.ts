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

  it("maps the ip.thc.org text response into dashboard rows", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("example.com\napi.example.com\nstaging.example.com\n", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const request = new Request("http://localhost:3000/api/subdomains?domain=example.com");
    const response = await GET(request);

    expect(response.status).toBe(200);
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
    });
  });

  it("handles sb responses that claim json content-type but return plain text", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("google.com\nmail.google.com\n", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = new Request("http://localhost:3000/api/subdomains?domain=google.com");
    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      domain: "google.com",
      results: [
        {
          id: "google.com-0",
          subdomain: "google.com",
          type: "Apex",
          status: "Primary",
        },
        {
          id: "mail.google.com-1",
          subdomain: "mail.google.com",
          type: "Messaging",
          status: "Service",
        },
      ],
    });
  });
});
