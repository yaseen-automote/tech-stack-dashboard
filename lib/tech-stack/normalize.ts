import { isValidDomain, normalizeDomainInput } from "@/lib/subdomain-intelligence";
import type { NormalizedTechStackTarget } from "@/lib/tech-stack/types";

export function normalizeTechStackTarget(input: string): NormalizedTechStackTarget | null {
  const rawInput = input.trim();

  if (rawInput.length === 0) {
    return null;
  }

  const normalizedDomain = normalizeDomainInput(rawInput);
  if (isValidDomain(normalizedDomain)) {
    return {
      rawInput,
      canonicalHostname: normalizedDomain,
      normalizedUrl: `https://${normalizedDomain}`,
      displayTarget: normalizedDomain,
    };
  }

  try {
    const url = new URL(rawInput);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    const canonicalHostname = normalizeDomainInput(url.hostname);
    if (!isValidDomain(canonicalHostname)) {
      return null;
    }

    return {
      rawInput,
      canonicalHostname,
      normalizedUrl: `${url.protocol}//${canonicalHostname}`,
      displayTarget: canonicalHostname,
    };
  } catch {
    return null;
  }
}

export function isValidTechStackTarget(input: string) {
  return normalizeTechStackTarget(input) !== null;
}
