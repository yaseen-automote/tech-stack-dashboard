import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DashboardShell } from "@/components/dashboard-shell";

describe("DashboardShell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the compact lookup shell with all current tabs", () => {
    render(<DashboardShell />);

    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getAllByRole("navigation").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Domain & Subdomain Discovery").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CNAME Lookup").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reverse DNS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tech Stack").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CT Monitor").length).toBeGreaterThan(0);
    expect(screen.getByRole("search", { name: /subdomain lookup/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /search scope/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /both/i })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Domain search terms" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Subdomain search terms" })).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: /modifier/i })).toHaveLength(2);
    expect(
      screen.getByText((content) => content.includes("match all subdomains for a domain search")),
    ).toBeInTheDocument();
    expect(screen.getByText("Enter one or more search terms above to start")).toBeInTheDocument();
  });

  it("submits the advanced subdomain form and shows paginated results", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.spyOn(global, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    render(<DashboardShell />);

    fireEvent.change(screen.getByRole("textbox", { name: "Domain search terms" }), {
      target: { value: "example.com" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    expect(screen.getByTestId("results-skeleton")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/subdomains?scope=both&domainTerm=example.com&domainModifier=contains&subdomainTerm=&subdomainModifier=contains",
      expect.objectContaining({
        cache: "no-store",
      }),
    );

    resolveFetch?.(
      Response.json({
        domain: "example.com",
        results: Array.from({ length: 21 }, (_, index) => ({
          id: `host-${index}`,
          subdomain: `${index === 20 ? "zeta" : `node-${index + 1}`}.example.com`,
          type: index % 3 === 0 ? "Infrastructure" : "Application",
          status: index % 3 === 0 ? "Watch" : "Live",
        })),
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Subdomain Results" })).toBeInTheDocument();
    });

    expect(screen.getByText("scope: both | domain contains \"example.com\"")).toBeInTheDocument();
    expect(screen.getAllByText("node-1.example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Page 1 of 2").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    expect(screen.getAllByText("zeta.example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Page 2 of 2").length).toBeGreaterThan(0);
  });

  it("shows an inline validation error when the subdomain query has no effective terms", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<DashboardShell />);

    const domainInput = screen.getByRole("textbox", { name: "Domain search terms" });
    const subdomainInput = screen.getByRole("textbox", { name: "Subdomain search terms" });

    fireEvent.change(domainInput, {
      target: { value: "*" },
    });
    fireEvent.change(subdomainInput, {
      target: { value: "   " },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(domainInput).toHaveAttribute("aria-invalid", "true");
      expect(subdomainInput).toHaveAttribute("aria-invalid", "true");
    });

    expect(
      screen.getByText(
        "Enter at least one domain or subdomain search term to inspect subdomain infrastructure.",
      ),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects raw SQL-style wildcards in the subdomain form", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<DashboardShell />);

    const domainInput = screen.getByRole("textbox", { name: "Domain search terms" });
    const subdomainInput = screen.getByRole("textbox", { name: "Subdomain search terms" });

    fireEvent.change(domainInput, {
      target: { value: "example.com" },
    });
    fireEvent.change(subdomainInput, {
      target: { value: "%admin_" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(subdomainInput).toHaveAttribute("aria-invalid", "true");
    });

    expect(domainInput).not.toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Use * as the only wildcard in domain and subdomain search terms."),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects embedded asterisk wildcards in subdomain search terms", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<DashboardShell />);

    fireEvent.change(screen.getByRole("textbox", { name: "Domain search terms" }), {
      target: { value: "exa*mple.com" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Use * only as a standalone wildcard in domain and subdomain search terms."),
      ).toBeInTheDocument();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects prefix or suffix asterisk wildcards in subdomain search terms", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<DashboardShell />);

    fireEvent.change(screen.getByRole("textbox", { name: "Subdomain search terms" }), {
      target: { value: "*api" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Use * only as a standalone wildcard in domain and subdomain search terms."),
      ).toBeInTheDocument();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires an effective domain term when scope is Domains only", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<DashboardShell />);

    fireEvent.click(screen.getByRole("radio", { name: "Domains only" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Subdomain search terms" }), {
      target: { value: "api" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Enter at least one domain search term to inspect subdomain infrastructure.",
        ),
      ).toBeInTheDocument();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires an effective subdomain term when scope is Subdomains only", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<DashboardShell />);

    fireEvent.click(screen.getByRole("radio", { name: "Subdomains only" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Domain search terms" }), {
      target: { value: "example.com" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Enter at least one subdomain search term to inspect subdomain infrastructure.",
        ),
      ).toBeInTheDocument();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses scope-aware summary text for Domains only searches", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        domain: "example.com",
        results: [
          {
            id: "host-0",
            subdomain: "example.com",
            type: "Apex",
            status: "Primary",
          },
        ],
      }),
    );

    render(<DashboardShell />);

    fireEvent.click(screen.getByRole("radio", { name: "Domains only" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Domain search terms" }), {
      target: { value: "example.com" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Subdomain search terms" }), {
      target: { value: "api" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/subdomains?scope=domains&domainTerm=example.com&domainModifier=contains&subdomainTerm=api&subdomainModifier=contains",
        expect.objectContaining({
          cache: "no-store",
        }),
      );
    });

    expect(screen.getByText('scope: domains | domain contains "example.com"')).toBeInTheDocument();
    expect(
      screen.queryByText(/scope: domains \| domain contains "example\.com" \| subdomain contains "api"/i),
    ).not.toBeInTheDocument();
  });

  it("clears stale results after a successful search followed by an invalid submit", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        domain: "example.com",
        results: [
          {
            id: "host-0",
            subdomain: "api.example.com",
            type: "Application",
            status: "Live",
          },
        ],
      }),
    );

    render(<DashboardShell />);

    const domainInput = screen.getByRole("textbox", { name: "Domain search terms" });
    const searchForm = screen.getByRole("search", { name: /subdomain lookup/i });

    fireEvent.change(domainInput, {
      target: { value: "example.com" },
    });
    fireEvent.submit(searchForm);

    await waitFor(() => {
      expect(screen.getAllByText("api.example.com").length).toBeGreaterThan(0);
    });

    fireEvent.change(domainInput, {
      target: { value: "exa*mple.com" },
    });
    fireEvent.submit(searchForm);

    await waitFor(() => {
      expect(
        screen.getByText("Use * only as a standalone wildcard in domain and subdomain search terms."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("api.example.com")).not.toBeInTheDocument();
    expect(screen.queryByText('scope: both | domain contains "example.com"')).not.toBeInTheDocument();
  });

  it("only marks the relevant input invalid for a scope-specific validation error and keeps backend errors off field invalid state", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json(
        {
          error: "The lookup could not be completed.",
        },
        { status: 502 },
      ),
    );

    render(<DashboardShell />);

    const domainInput = screen.getByRole("textbox", { name: "Domain search terms" });
    const subdomainInput = screen.getByRole("textbox", { name: "Subdomain search terms" });

    expect(screen.getByRole("combobox", { name: "Domain modifier" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Subdomain modifier" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Domains only" }));
    fireEvent.change(subdomainInput, {
      target: { value: "api" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(domainInput).toHaveAttribute("aria-invalid", "true");
    });

    expect(subdomainInput).not.toHaveAttribute("aria-invalid", "true");

    fireEvent.change(domainInput, {
      target: { value: "example.com" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(screen.getAllByText("The lookup could not be completed.").length).toBeGreaterThan(0);
    });

    expect(domainInput).not.toHaveAttribute("aria-invalid", "true");
    expect(subdomainInput).not.toHaveAttribute("aria-invalid", "true");
  });

  it("switches to reverse DNS lookup and submits an IP address to the reverse DNS endpoint", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        domain: "142.251.43.46",
        results: [
          {
            id: "sea30s10-in-f14.1e100.net-0",
            subdomain: "sea30s10-in-f14.1e100.net",
            type: "Reverse DNS",
            status: "Live",
          },
        ],
      }),
    );

    render(<DashboardShell />);

    fireEvent.click(screen.getAllByRole("button", { name: /reverse dns/i })[0]);

    fireEvent.change(screen.getByRole("searchbox", { name: /search or inspect an ip address/i }), {
      target: { value: "142.251.43.46" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /reverse dns lookup/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/reverse-dns?ip=142.251.43.46",
        expect.objectContaining({
          cache: "no-store",
        }),
      );
    });

    expect(screen.getByRole("heading", { name: "Reverse DNS Results" })).toBeInTheDocument();
    expect(screen.getAllByText("sea30s10-in-f14.1e100.net").length).toBeGreaterThan(0);
  });

  it("switches to tech stack lookup and renders categorized detections with evidence", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      Response.json({
        target: "stripe.com",
        results: [
          {
            id: "stripe-script",
            technology: "Stripe",
            category: "Payments / Widgets",
            confidence: "high",
            source: "script",
            evidence: ["Script source matched js.stripe.com"],
          },
          {
            id: "next-header",
            technology: "Next.js",
            category: "Framework / Runtime",
            confidence: "medium",
            source: "header",
            evidence: ["Header x-powered-by contained Next.js"],
          },
        ],
      }),
    );

    render(<DashboardShell />);

    fireEvent.click(screen.getAllByRole("button", { name: /tech stack/i })[0]);

    const websiteInput = screen.getByRole("searchbox", {
      name: /search or inspect a website/i,
    });

    expect(websiteInput).toHaveAttribute(
      "placeholder",
      "Enter a website URL or domain, e.g. stripe.com",
    );

    fireEvent.change(websiteInput, {
      target: { value: "https://stripe.com/pricing" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /tech stack/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/tech-stack?target=stripe.com",
        expect.objectContaining({
          cache: "no-store",
        }),
      );
    });

    expect(screen.getByRole("heading", { name: "Tech Stack Results" })).toBeInTheDocument();
    expect(screen.getAllByText("Stripe").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Next.js").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Payments / Widgets").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Framework / Runtime").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Script source matched js.stripe.com").length).toBeGreaterThan(0);

    const mobileResults = screen.getByTestId("tech-stack-mobile-results");
    expect(within(mobileResults).getByText("Stripe")).toBeInTheDocument();
    expect(within(mobileResults).getByText("Next.js")).toBeInTheDocument();
  });

  it("switches to CT Monitor and renders alert summary, feed, and watchlist data", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = String(input);

      if (url === "/api/alerts/summary") {
        return Promise.resolve(
          Response.json({
            newestDumpDate: "2026-05-18",
            totals: {
              alerts: 12,
              phishing: 5,
              brandProtection: 4,
              shadowIt: 3,
              highSeverity: 7,
            },
          }),
        );
      }

      if (url.startsWith("/api/alerts?")) {
        return Promise.resolve(
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
              limit: 20,
              offset: 0,
              total: 1,
            },
          }),
        );
      }

      if (url === "/api/watchlists") {
        return Promise.resolve(
          Response.json({
            entries: [
              {
                entryId: "3f8ea328-7f4f-4476-9ad4-a80b426fd444",
                watchType: "brand",
                term: "openai",
                enabled: true,
              },
            ],
          }),
        );
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(<DashboardShell />);

    fireEvent.click(screen.getAllByRole("button", { name: /ct monitor/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /certificate transparency alert feed/i })).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/alerts/summary",
      expect.objectContaining({
        cache: "no-store",
      }),
    );
    expect(screen.getAllByText("secure-openai-login.net")).toHaveLength(2);
    expect(
      within(screen.getByTestId("ct-alerts-mobile-results")).getByText("secure-openai-login.net"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    const watchlistPanel = screen.getByTestId("ct-watchlist-panel");
    expect(watchlistPanel).toBeInTheDocument();
    expect(within(watchlistPanel).getByText("openai")).toBeInTheDocument();
  });

  it("keeps the CT alert feed visible when watchlist loading fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = String(input);

      if (url === "/api/alerts/summary") {
        return Promise.resolve(
          Response.json({
            newestDumpDate: "2026-05-18",
            totals: {
              alerts: 4,
              phishing: 2,
              brandProtection: 1,
              shadowIt: 1,
              highSeverity: 3,
            },
          }),
        );
      }

      if (url.startsWith("/api/alerts?")) {
        return Promise.resolve(
          Response.json({
            results: [
              {
                id: "alert-2",
                observedAt: "2026-05-18",
                domain: "vpn-openai-support.net",
                category: "phishing",
                severity: "high",
                watchType: "brand",
                matchedTerm: "openai",
                reasons: ["contains watched brand term", "contains risky keyword: support"],
              },
            ],
            pagination: {
              limit: 20,
              offset: 0,
              total: 1,
            },
          }),
        );
      }

      if (url === "/api/watchlists") {
        return Promise.resolve(
          Response.json({ error: "watchlists unavailable" }, { status: 503 }),
        );
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(<DashboardShell />);

    fireEvent.click(screen.getAllByRole("button", { name: /ct monitor/i })[0]);

    await waitFor(() => {
      expect(screen.getAllByText("vpn-openai-support.net").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("watchlists unavailable")).toBeInTheDocument();
    expect(screen.queryByText("The CT alert feed could not be loaded.")).not.toBeInTheDocument();
  });
});
