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
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getAllByText("Subdomain Lookup").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CNAME Lookup").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reverse DNS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tech Stack").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("searchbox", { name: /search or inspect a domain/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("search", { name: /subdomain lookup/i })).toBeInTheDocument();
    expect(screen.getByText("Enter a domain above to start")).toBeInTheDocument();
  });

  it("shows a loading skeleton, then paginated subdomain results after a search", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.spyOn(global, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    render(<DashboardShell />);

    fireEvent.change(screen.getByRole("searchbox", { name: /search or inspect a domain/i }), {
      target: { value: "example.com" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    expect(screen.getByTestId("results-skeleton")).toBeInTheDocument();

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

    expect(screen.getAllByText("node-1.example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Page 1 of 2").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    expect(screen.getAllByText("zeta.example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Page 2 of 2").length).toBeGreaterThan(0);
  });

  it("shows an inline validation error for an invalid domain", async () => {
    render(<DashboardShell />);

    const searchInput = screen.getByRole("searchbox", { name: /search or inspect a domain/i });

    fireEvent.change(searchInput, {
      target: { value: "google" },
    });
    fireEvent.submit(screen.getByRole("search", { name: /subdomain lookup/i }));

    await waitFor(() => {
      expect(searchInput).toHaveAttribute("aria-invalid", "true");
    });

    expect(screen.getByText("Enter a valid apex domain.")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /reverse dns/i }));

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

    fireEvent.click(screen.getByRole("button", { name: /tech stack/i }));

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
});
