import { Hono } from "hono";

import {
  isValidDomain,
  isValidIpAddress,
  normalizeDomainInput,
  normalizeIpInput,
} from "@/lib/subdomain-intelligence";

import type { BulkApiConfig } from "./config";
import type { BulkApiLookupService } from "./service";

const INVALID_DOMAIN_SUBDOMAINS_ERROR =
  "Enter a valid domain to inspect subdomain infrastructure.";
const INVALID_DOMAIN_CNAMES_ERROR = "Enter a valid domain to inspect CNAME records.";
const INVALID_DOMAIN_SUMMARY_ERROR = "Enter a valid domain to inspect infrastructure summary.";
const INVALID_IP_ERROR = "Enter a valid IP address to inspect reverse DNS records.";

type CreateBulkApiAppOptions = {
  config: BulkApiConfig;
  lookupService: BulkApiLookupService;
};

function normalizeLimit(
  value: string | null | undefined,
  fallback: number,
  max = 500,
) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(parsed), max);
}

export function createBulkApiApp(options: CreateBulkApiAppOptions) {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "bulk-api",
      activeSnapshotMonth: options.config.activeSnapshotMonth,
    }),
  );

  app.get("/v1/reverse-ip", async (c) => {
    const ip = normalizeIpInput(c.req.query("ip") ?? "");

    if (!isValidIpAddress(ip)) {
      return c.json({ error: INVALID_IP_ERROR }, 400);
    }

    try {
      const response = await options.lookupService.lookupReverseIp({
        ip,
        limit: normalizeLimit(c.req.query("limit"), 10),
      });

      return c.json(response);
    } catch {
      return c.json({ error: "The reverse DNS lookup request could not be completed." }, 502);
    }
  });

  app.get("/v1/subdomains", async (c) => {
    const domain = normalizeDomainInput(c.req.query("domain") ?? "");

    if (!isValidDomain(domain)) {
      return c.json({ error: INVALID_DOMAIN_SUBDOMAINS_ERROR }, 400);
    }

    try {
      const response = await options.lookupService.lookupSubdomains({
        domain,
        limit: normalizeLimit(c.req.query("limit"), 100),
      });

      return c.json(response);
    } catch {
      return c.json({ error: "The subdomain lookup request could not be completed." }, 502);
    }
  });

  app.get("/v1/cnames", async (c) => {
    const domain = normalizeDomainInput(c.req.query("domain") ?? "");

    if (!isValidDomain(domain)) {
      return c.json({ error: INVALID_DOMAIN_CNAMES_ERROR }, 400);
    }

    try {
      const response = await options.lookupService.lookupCnames({
        domain,
        limit: normalizeLimit(c.req.query("limit"), 25),
      });

      return c.json(response);
    } catch {
      return c.json({ error: "The CNAME lookup request could not be completed." }, 502);
    }
  });

  app.get("/v1/infrastructure/summary", async (c) => {
    const domain = normalizeDomainInput(c.req.query("domain") ?? "");

    if (!isValidDomain(domain)) {
      return c.json({ error: INVALID_DOMAIN_SUMMARY_ERROR }, 400);
    }

    try {
      const response = await options.lookupService.lookupInfrastructureSummary({ domain });

      return c.json(response);
    } catch {
      return c.json(
        { error: "The infrastructure summary lookup request could not be completed." },
        502,
      );
    }
  });

  return app;
}
