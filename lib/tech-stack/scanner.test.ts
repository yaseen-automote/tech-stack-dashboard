import { normalizeTechStackTarget } from "@/lib/tech-stack/normalize";
import { scanTechStackTarget } from "@/lib/tech-stack/scanner";

describe("scanTechStackTarget", () => {
  it("extracts homepage, probe, and dns signals into a normalized bundle", async () => {
    const fetchFn = vi.fn(async (input: string) => {
      if (input === "https://stripe.com") {
        return new Response(
          [
            "<html>",
            '<head><meta name="generator" content="WordPress" />',
            '<script src="https://js.stripe.com/v3"></script>',
            '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-123"></script>',
            '<link rel="preconnect" href="https://fonts.googleapis.com" />',
            "</head>",
            '<body><div id="__next"></div><script>window.__NEXT_DATA__ = {};</script></body>',
            "</html>",
          ].join(""),
          {
            status: 200,
            headers: {
              Server: "cloudflare",
              "X-Powered-By": "Next.js",
              "Content-Security-Policy": "default-src 'self'",
              "Set-Cookie": "__cf_bm=1; Path=/,hubspotutk=abc; Path=/",
            },
          },
        );
      }

      if (input === "https://stripe.com/robots.txt") {
        return new Response("User-agent: *", { status: 200 });
      }

      if (input === "https://stripe.com/favicon.ico") {
        return new Response("ico", { status: 200 });
      }

      return new Response("missing", { status: 404 });
    });

    const dnsResolver = {
      resolveNs: vi.fn().mockResolvedValue(["alice.ns.cloudflare.com"]),
      resolveMx: vi.fn().mockResolvedValue(["10 aspmx.l.google.com"]),
      resolveTxt: vi.fn().mockResolvedValue([["v=spf1 include:_spf.google.com ~all"]]),
      resolveCname: vi.fn().mockResolvedValue(["cname.vercel-dns.com"]),
    };

    const target = normalizeTechStackTarget("stripe.com");
    if (!target) {
      throw new Error("Expected normalized target");
    }

    const result = await scanTechStackTarget(target, { fetchFn, dnsResolver });

    expect(result.input.canonicalHostname).toBe("stripe.com");
    expect(result.http.headers.server).toBe("cloudflare");
    expect(result.http.headers["x-powered-by"]).toBe("Next.js");
    expect(result.http.scriptSrcs).toContain("https://js.stripe.com/v3");
    expect(result.http.scriptSrcs).toContain("https://www.googletagmanager.com/gtm.js?id=GTM-123");
    expect(result.http.inlineScripts).toContain("window.__NEXT_DATA__ = {};");
    expect(result.http.linkHrefs).toContain("https://fonts.googleapis.com");
    expect(result.http.meta.generator).toBe("WordPress");
    expect(result.http.cookies).toEqual(["__cf_bm", "hubspotutk"]);
    expect(result.probes["/robots.txt"]).toMatchObject({ ok: true, status: 200 });
    expect(result.probes["/favicon.ico"]).toMatchObject({ ok: true, status: 200 });
    expect(result.dns.ns).toContain("alice.ns.cloudflare.com");
    expect(result.dns.mx).toContain("10 aspmx.l.google.com");
    expect(result.dns.txt).toContain("v=spf1 include:_spf.google.com ~all");
    expect(result.dns.cname).toContain("cname.vercel-dns.com");
    expect(result.security.csp).toBe(true);
  });

  it("continues when probes or dns record lookups fail", async () => {
    const fetchFn = vi.fn(async (input: string) => {
      if (input === "https://vercel.com") {
        return new Response("<html><body>ok</body></html>", {
          status: 200,
          headers: { Server: "Vercel" },
        });
      }

      throw new Error(`probe failed for ${input}`);
    });

    const dnsResolver = {
      resolveNs: vi.fn().mockRejectedValue(new Error("ns unavailable")),
      resolveMx: vi.fn().mockResolvedValue(["10 mx.example.com"]),
      resolveTxt: vi.fn().mockRejectedValue(new Error("txt unavailable")),
      resolveCname: vi.fn().mockRejectedValue(new Error("cname unavailable")),
    };

    const target = normalizeTechStackTarget("vercel.com");
    if (!target) {
      throw new Error("Expected normalized target");
    }

    const result = await scanTechStackTarget(target, {
      fetchFn,
      dnsResolver,
      probePaths: ["/robots.txt"],
    });

    expect(result.http.headers.server).toBe("Vercel");
    expect(result.probes["/robots.txt"]).toMatchObject({ ok: false });
    expect(result.dns.ns).toEqual([]);
    expect(result.dns.mx).toEqual(["10 mx.example.com"]);
    expect(result.dns.txt).toEqual([]);
    expect(result.dns.cname).toEqual([]);
  });
});
