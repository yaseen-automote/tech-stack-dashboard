import { evaluateTechStackSignals } from "@/lib/tech-stack/evaluator";
import type { TechDetectionRule, TechStackScanSignals } from "@/lib/tech-stack/types";

function createSignals(): TechStackScanSignals {
  return {
    input: {
      rawInput: "https://example.com",
      canonicalHostname: "example.com",
      normalizedUrl: "https://example.com",
      finalUrl: "https://example.com",
    },
    http: {
      status: 200,
      headers: {
        server: "cloudflare",
        "x-powered-by": "Next.js",
        "content-security-policy": "default-src 'self'",
      },
      cookies: ["_ga", "__cf_bm", "hubspotutk"],
      html: '<div id="__next"></div><script>window.__NEXT_DATA__={}</script><span data-reactroot="true"></span>',
      scriptSrcs: [
        "https://js.stripe.com/v3",
        "https://www.googletagmanager.com/gtm.js?id=GTM-123",
      ],
      inlineScripts: ["window.__NEXT_DATA__={}"],
      linkHrefs: ["https://fonts.googleapis.com/css2?family=Inter"],
      meta: {
        generator: "WordPress",
      },
    },
    probes: {
      "/robots.txt": {
        ok: true,
        status: 200,
        headers: {},
        body: "User-agent: *",
      },
    },
    dns: {
      ns: ["alice.ns.cloudflare.com"],
      mx: ["10 aspmx.l.google.com"],
      txt: ["v=spf1 include:_spf.google.com ~all"],
      cname: ["cname.vercel-dns.com"],
    },
    security: {
      csp: true,
      hsts: false,
      xFrameOptions: false,
      xContentTypeOptions: false,
      referrerPolicy: false,
    },
  };
}

describe("evaluateTechStackSignals", () => {
  it("matches the supported matcher families and returns evidence", () => {
    const rules: TechDetectionRule[] = [
      {
        id: "next-header",
        technology: "Next.js",
        category: "Framework / Runtime",
        confidence: "high",
        matcher: {
          type: "header-contains",
          header: "x-powered-by",
          value: "Next.js",
        },
      },
      {
        id: "stripe-script",
        technology: "Stripe",
        category: "Payments / Widgets",
        confidence: "high",
        matcher: {
          type: "script-src-regex",
          pattern: "js\\.stripe\\.com",
        },
      },
      {
        id: "fonts-link",
        technology: "Google Fonts",
        category: "Frontend / UI",
        confidence: "medium",
        matcher: {
          type: "link-href-regex",
          pattern: "fonts\\.googleapis\\.com",
        },
      },
      {
        id: "react-html",
        technology: "React",
        category: "Frontend / UI",
        confidence: "medium",
        matcher: {
          type: "html-regex",
          pattern: "data-reactroot",
        },
      },
      {
        id: "google-analytics-cookie",
        technology: "Google Analytics",
        category: "Analytics / Tag Manager",
        confidence: "low",
        matcher: {
          type: "cookie-name",
          cookieName: "_ga",
        },
      },
      {
        id: "wordpress-meta",
        technology: "WordPress",
        category: "CMS / Metadata",
        confidence: "high",
        matcher: {
          type: "meta-generator-contains",
          value: "wordpress",
        },
      },
      {
        id: "google-workspace-dns",
        technology: "Google Workspace",
        category: "DNS / Mail / Security",
        confidence: "medium",
        matcher: {
          type: "dns-pattern",
          recordType: "mx",
          pattern: "google\\.com",
        },
      },
      {
        id: "csp-present",
        technology: "Content Security Policy",
        category: "DNS / Mail / Security",
        confidence: "low",
        matcher: {
          type: "security-header-present",
          header: "content-security-policy",
        },
      },
    ];

    const results = evaluateTechStackSignals(createSignals(), rules);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technology: "Next.js",
          confidence: "high",
          source: "header",
          evidence: ["Header x-powered-by contained Next.js"],
        }),
        expect.objectContaining({
          technology: "Stripe",
          source: "script",
          evidence: ["Script source matched js\\.stripe\\.com"],
        }),
        expect.objectContaining({
          technology: "Google Fonts",
          source: "link",
        }),
        expect.objectContaining({
          technology: "React",
          source: "html",
        }),
        expect.objectContaining({
          technology: "Google Analytics",
          source: "cookie",
        }),
        expect.objectContaining({
          technology: "WordPress",
          source: "meta",
        }),
        expect.objectContaining({
          technology: "Google Workspace",
          source: "dns",
        }),
        expect.objectContaining({
          technology: "Content Security Policy",
          source: "security",
        }),
      ]),
    );
  });

  it("supports combined rules and deduplicates technologies by highest confidence", () => {
    const rules: TechDetectionRule[] = [
      {
        id: "cloudflare-header-only",
        technology: "Cloudflare",
        category: "CDN / WAF",
        confidence: "medium",
        matcher: {
          type: "header-contains",
          header: "server",
          value: "cloudflare",
        },
      },
      {
        id: "cloudflare-combined",
        technology: "Cloudflare",
        category: "CDN / WAF",
        confidence: "high",
        matcher: {
          type: "combined",
          matchers: [
            {
              type: "header-contains",
              header: "server",
              value: "cloudflare",
            },
            {
              type: "dns-pattern",
              recordType: "ns",
              pattern: "cloudflare",
            },
          ],
        },
      },
    ];

    const results = evaluateTechStackSignals(createSignals(), rules);

    expect(results).toEqual([
      {
        id: "cloudflare-combined",
        technology: "Cloudflare",
        category: "CDN / WAF",
        confidence: "high",
        source: "header",
        evidence: [
          "Header server contained cloudflare",
          "DNS ns matched cloudflare",
        ],
      },
    ]);
  });
});
