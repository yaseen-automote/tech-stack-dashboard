import { GET } from "@/app/api/tech-stack/route";
import { scanTechStackTarget } from "@/lib/tech-stack/scanner";
import { evaluateTechStackSignals } from "@/lib/tech-stack/evaluator";

vi.mock("@/lib/tech-stack/scanner", () => ({
  scanTechStackTarget: vi.fn(),
}));

vi.mock("@/lib/tech-stack/evaluator", () => ({
  evaluateTechStackSignals: vi.fn(),
}));

describe("GET /api/tech-stack", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects invalid targets before attempting a scan", async () => {
    const request = new Request("http://localhost:3000/api/tech-stack?target=not a target");
    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(scanTechStackTarget).not.toHaveBeenCalled();
    expect(evaluateTechStackSignals).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Enter a valid domain or URL to inspect the website tech stack.",
    });
  });

  it("returns evaluated tech detections for a valid target", async () => {
    vi.mocked(scanTechStackTarget).mockResolvedValue({
      input: {
        rawInput: "stripe.com",
        canonicalHostname: "stripe.com",
        normalizedUrl: "https://stripe.com",
        finalUrl: "https://stripe.com",
      },
      http: {
        status: 200,
        headers: {},
        cookies: [],
        html: "",
        scriptSrcs: [],
        inlineScripts: [],
        linkHrefs: [],
        meta: {},
      },
      probes: {},
      dns: {
        ns: [],
        mx: [],
        txt: [],
        cname: [],
      },
      security: {
        csp: false,
        hsts: false,
        xFrameOptions: false,
        xContentTypeOptions: false,
        referrerPolicy: false,
      },
    });

    vi.mocked(evaluateTechStackSignals).mockReturnValue([
      {
        id: "stripe-script",
        technology: "Stripe",
        category: "Payments / Widgets",
        confidence: "high",
        source: "script",
        evidence: ["Script source matched js\\.stripe\\.com"],
      },
    ]);

    const request = new Request("http://localhost:3000/api/tech-stack?target=stripe.com");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(scanTechStackTarget).toHaveBeenCalledWith({
      rawInput: "stripe.com",
      canonicalHostname: "stripe.com",
      normalizedUrl: "https://stripe.com",
      displayTarget: "stripe.com",
    });
    expect(evaluateTechStackSignals).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      target: "stripe.com",
      results: [
        {
          id: "stripe-script",
          technology: "Stripe",
          category: "Payments / Widgets",
          confidence: "high",
          source: "script",
          evidence: ["Script source matched js\\.stripe\\.com"],
        },
      ],
    });
  });

  it("returns a scan failure error when scanning throws", async () => {
    vi.mocked(scanTechStackTarget).mockRejectedValue(new Error("boom"));

    const request = new Request("http://localhost:3000/api/tech-stack?target=stripe.com");
    const response = await GET(request);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "The tech stack scan could not be completed right now.",
    });
  });
});
