import {
  resolveCname,
  resolveMx,
  resolveNs,
  resolveTxt,
} from "node:dns/promises";
import type { NormalizedTechStackTarget, TechStackScanSignals } from "@/lib/tech-stack/types";

const DEFAULT_PROBE_PATHS = [
  "/robots.txt",
  "/favicon.ico",
  "/.well-known/security.txt",
  "/.well-known/assetlinks.json",
  "/.well-known/apple-app-site-association",
];

type DnsResolver = {
  resolveNs: typeof resolveNs;
  resolveMx: typeof resolveMx;
  resolveTxt: typeof resolveTxt;
  resolveCname: typeof resolveCname;
};

type TechStackScannerOptions = {
  fetchFn: typeof fetch;
  dnsResolver: DnsResolver;
  probePaths: string[];
};

export async function scanTechStackTarget(
  target: NormalizedTechStackTarget,
  options: Partial<TechStackScannerOptions> = {},
): Promise<TechStackScanSignals> {
  const fetchFn = options.fetchFn ?? fetch;
  const dnsResolver = options.dnsResolver ?? {
    resolveNs,
    resolveMx,
    resolveTxt,
    resolveCname,
  };
  const probePaths = options.probePaths ?? DEFAULT_PROBE_PATHS;

  const response = await fetchDocument(target.normalizedUrl, fetchFn);
  const html = await response.text();
  const headers = normalizeHeaders(response.headers);

  const [probes, dns] = await Promise.all([
    collectProbes(target.normalizedUrl, probePaths, fetchFn),
    collectDnsSignals(target.canonicalHostname, dnsResolver),
  ]);

  return {
    input: {
      rawInput: target.rawInput,
      canonicalHostname: target.canonicalHostname,
      normalizedUrl: target.normalizedUrl,
      finalUrl: response.url || target.normalizedUrl,
    },
    http: {
      status: response.status,
      headers,
      cookies: extractCookieNames(headers["set-cookie"]),
      html,
      scriptSrcs: extractAttributeValues(html, "script", "src"),
      inlineScripts: extractInlineScripts(html),
      linkHrefs: extractAttributeValues(html, "link", "href"),
      meta: extractMetaTags(html),
    },
    probes,
    dns,
    security: {
      csp: Boolean(headers["content-security-policy"]),
      hsts: Boolean(headers["strict-transport-security"]),
      xFrameOptions: Boolean(headers["x-frame-options"]),
      xContentTypeOptions: Boolean(headers["x-content-type-options"]),
      referrerPolicy: Boolean(headers["referrer-policy"]),
    },
  };
}

async function fetchDocument(url: string, fetchFn: typeof fetch) {
  try {
    return await fetchFn(url, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (error) {
    if (!url.startsWith("https://")) {
      throw error;
    }

    return fetchFn(url.replace(/^https:\/\//, "http://"), {
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });
  }
}

async function collectProbes(url: string, probePaths: string[], fetchFn: typeof fetch) {
  const entries = await Promise.all(
    probePaths.map(async (path) => {
      const probeUrl = new URL(path, `${url}/`).toString();

      try {
        const response = await fetchFn(probeUrl, {
          cache: "no-store",
          redirect: "follow",
        });

        return [
          path,
          {
            ok: response.ok,
            status: response.status,
            headers: normalizeHeaders(response.headers),
            body: await response.text(),
          },
        ] as const;
      } catch {
        return [path, { ok: false }] as const;
      }
    }),
  );

  return Object.fromEntries(entries);
}

async function collectDnsSignals(hostname: string, dnsResolver: DnsResolver) {
  const [ns, mx, txt, cname] = await Promise.all([
    safeResolve(() => dnsResolver.resolveNs(hostname)),
    safeResolve(() => dnsResolver.resolveMx(hostname)),
    safeResolve(() => dnsResolver.resolveTxt(hostname)),
    safeResolve(() => dnsResolver.resolveCname(hostname)),
  ]);

  return {
    ns: ns.map(String),
    mx: mx.map((record) => {
      if (typeof record === "string") {
        return record;
      }

      return `${record.priority} ${record.exchange}`;
    }),
    txt: txt.flatMap((record) => {
      if (Array.isArray(record)) {
        return [record.join("")];
      }

      return [String(record)];
    }),
    cname: cname.map(String),
  };
}

async function safeResolve<T>(resolver: () => Promise<T>): Promise<T extends Array<infer U> ? U[] : never[]> {
  try {
    return (await resolver()) as T extends Array<infer U> ? U[] : never[];
  } catch {
    return [] as T extends Array<infer U> ? U[] : never[];
  }
}

function normalizeHeaders(headers: Headers) {
  return Object.fromEntries(
    Array.from(headers.entries()).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function extractAttributeValues(html: string, tagName: string, attributeName: string) {
  const pattern = new RegExp(
    `<${tagName}\\b[^>]*\\s${attributeName}=["']([^"']+)["'][^>]*>`,
    "gi",
  );

  return Array.from(html.matchAll(pattern), (match) => match[1] ?? "");
}

function extractInlineScripts(html: string) {
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

  return Array.from(html.matchAll(pattern))
    .map((match) => (match[1] ?? "").trim())
    .filter((script) => script.length > 0);
}

function extractMetaTags(html: string) {
  const pattern = /<meta\b[^>]*(?:name|property)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
  const entries = Array.from(html.matchAll(pattern)).map((match) => [
    (match[1] ?? "").toLowerCase(),
    match[2] ?? "",
  ]);

  return Object.fromEntries(entries);
}

function extractCookieNames(setCookieHeader?: string) {
  if (!setCookieHeader) {
    return [];
  }

  return setCookieHeader
    .split(/,(?=[^;,=\s]+=[^;,]+)/)
    .map((cookie) => cookie.trim().split("=")[0]?.trim())
    .filter((cookieName): cookieName is string => Boolean(cookieName));
}
