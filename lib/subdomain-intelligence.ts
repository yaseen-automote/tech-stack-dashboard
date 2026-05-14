export type SubdomainType =
  | "Apex"
  | "Application"
  | "Environment"
  | "Infrastructure"
  | "Delivery"
  | "Messaging"
  | "CNAME"
  | "Reverse DNS";

export type SubdomainStatus =
  | "Primary"
  | "Live"
  | "Review"
  | "Watch"
  | "Edge"
  | "Service";

export type SubdomainRecord = {
  id: string;
  subdomain: string;
  type: SubdomainType;
  status: SubdomainStatus;
};

const ENVIRONMENT_TOKENS = new Set([
  "alpha",
  "beta",
  "dev",
  "demo",
  "preview",
  "preprod",
  "qa",
  "sandbox",
  "stage",
  "staging",
  "test",
  "uat",
]);

const INFRASTRUCTURE_TOKENS = new Set([
  "admin",
  "auth",
  "bastion",
  "console",
  "cpanel",
  "dashboard",
  "gateway",
  "internal",
  "kibana",
  "manage",
  "monitor",
  "ops",
  "panel",
  "secure",
  "ssh",
  "status",
  "vpn",
]);

const DELIVERY_TOKENS = new Set([
  "assets",
  "cache",
  "cdn",
  "edge",
  "img",
  "media",
  "static",
]);

const MESSAGING_TOKENS = new Set([
  "autodiscover",
  "imap",
  "mail",
  "mx",
  "pop",
  "smtp",
  "webmail",
]);

const DOMAIN_PATTERN =
  /^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_SEGMENT_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV4_CIDR_PATTERN = /^(3[0-2]|[12]?\d)$/;
const IPV6_PATTERN =
  /^((?:[a-f0-9]{1,4}:){7}[a-f0-9]{1,4}|(?:[a-f0-9]{1,4}:){1,7}:|(?:[a-f0-9]{1,4}:){1,6}:[a-f0-9]{1,4}|(?:[a-f0-9]{1,4}:){1,5}(?::[a-f0-9]{1,4}){1,2}|(?:[a-f0-9]{1,4}:){1,4}(?::[a-f0-9]{1,4}){1,3}|(?:[a-f0-9]{1,4}:){1,3}(?::[a-f0-9]{1,4}){1,4}|(?:[a-f0-9]{1,4}:){1,2}(?::[a-f0-9]{1,4}){1,5}|[a-f0-9]{1,4}:(?:(?::[a-f0-9]{1,4}){1,6})|:(?:(?::[a-f0-9]{1,4}){1,7}|:))$/i;

export function normalizeDomainInput(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .replace(/\.$/, "");
}

export function normalizeIpInput(input: string) {
  return input.trim().replace(/^\[|\]$/g, "");
}

export function isValidDomain(domain: string) {
  return DOMAIN_PATTERN.test(domain);
}

export function isValidIpAddress(value: string) {
  const normalizedValue = normalizeIpInput(value);

  if (normalizedValue.length === 0) {
    return false;
  }

  const [address, cidr] = normalizedValue.split("/");

  if (cidr !== undefined && !IPV4_CIDR_PATTERN.test(cidr)) {
    return false;
  }

  const isIpv4 = address.split(".").length === 4 && address.split(".").every((segment) => IPV4_SEGMENT_PATTERN.test(segment));

  if (isIpv4) {
    return true;
  }

  if (cidr !== undefined) {
    return false;
  }

  return IPV6_PATTERN.test(address);
}

export function classifySubdomain(subdomain: string, domain: string) {
  if (subdomain === domain) {
    return { type: "Apex", status: "Primary" } as const;
  }

  const labels = subdomain
    .replace(new RegExp(`\\.?${escapeForPattern(domain)}$`), "")
    .split(".")
    .filter(Boolean);

  if (labels.some((label) => ENVIRONMENT_TOKENS.has(label))) {
    return { type: "Environment", status: "Review" } as const;
  }

  if (labels.some((label) => INFRASTRUCTURE_TOKENS.has(label))) {
    return { type: "Infrastructure", status: "Watch" } as const;
  }

  if (labels.some((label) => DELIVERY_TOKENS.has(label))) {
    return { type: "Delivery", status: "Edge" } as const;
  }

  if (labels.some((label) => MESSAGING_TOKENS.has(label))) {
    return { type: "Messaging", status: "Service" } as const;
  }

  return { type: "Application", status: "Live" } as const;
}

export function parseSubdomainResponse(rawResponse: string, domain: string) {
  const normalizedDomain = normalizeDomainInput(domain);
  const seen = new Set<string>();

  return rawResponse
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith(";"))
    .filter((line) => line === normalizedDomain || line.endsWith(`.${normalizedDomain}`))
    .filter((line) => {
      if (seen.has(line)) {
        return false;
      }

      seen.add(line);
      return true;
    })
    .map((subdomain, index) => ({
      id: `${subdomain}-${index}`,
      subdomain,
      ...classifySubdomain(subdomain, normalizedDomain),
    }));
}

export function parseSubdomainPayload(payload: unknown, domain: string) {
  if (typeof payload === "string") {
    return parseSubdomainResponse(payload, domain);
  }

  if (Array.isArray(payload)) {
    return parseSubdomainResponse(payload.join("\n"), domain);
  }

  if (payload && typeof payload === "object") {
    const candidateValues = Object.values(payload).find((value) => Array.isArray(value));
    if (Array.isArray(candidateValues)) {
      return parseSubdomainResponse(candidateValues.join("\n"), domain);
    }
  }

  return [];
}

function escapeForPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
