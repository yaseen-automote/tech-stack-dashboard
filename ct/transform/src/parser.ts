import { normalizeDomainInput } from "@/lib/subdomain-intelligence";
import type { ParsedCtLine } from "@/ct/types";

const HOSTNAME_PATTERN =
  /^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function isHostnameLike(value: string) {
  return HOSTNAME_PATTERN.test(normalizeDomainInput(value));
}

function extractStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[\s,;|]+/)
      .map((entry) => normalizeDomainInput(entry))
      .filter(isHostnameLike);
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => extractStringArray(entry))
      .filter(isHostnameLike);
  }

  return [];
}

function uniqueDomains(values: string[]) {
  return [...new Set(values.map((value) => normalizeDomainInput(value)).filter(isHostnameLike))];
}

function pickOptionalString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function pickOptionalDate(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function parseCtRawLine(rawLine: string): ParsedCtLine {
  const trimmed = rawLine.trim();

  if (trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        parseMode: "json",
        issuerName: pickOptionalString(payload, ["issuer_name", "issuer", "ca"]),
        notBefore: pickOptionalDate(payload, ["not_before", "valid_from"]),
        notAfter: pickOptionalDate(payload, ["not_after", "valid_to"]),
        domains: uniqueDomains([
          ...extractStringArray(payload.name_value),
          ...extractStringArray(payload.common_name),
          ...extractStringArray(payload.dns_names),
          ...extractStringArray(payload.subject_alt_names),
          ...extractStringArray(payload.all_domains),
        ]),
      };
    } catch {
      // Malformed JSON-like lines must not abort the transform.
    }
  }

  if (trimmed.includes("\t")) {
    return {
      parseMode: "tsv",
      issuerName: null,
      notBefore: null,
      notAfter: null,
      domains: uniqueDomains(trimmed.split("\t").flatMap((entry) => extractStringArray(entry))),
    };
  }

  return {
    parseMode: "plain",
    issuerName: null,
    notBefore: null,
    notAfter: null,
    domains: uniqueDomains(extractStringArray(trimmed)),
  };
}
