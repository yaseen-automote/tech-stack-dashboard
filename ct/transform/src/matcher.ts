import type { CtWatchlistEntry, ScoredCtAlert } from "@/ct/types";

function domainMatchesBrand(domain: string, brandTerm: string): boolean {
  const lower = domain.toLowerCase();
  const term = brandTerm.toLowerCase();
  return lower === term || lower.endsWith(`.${term}`);
}

function domainContainsTerm(domain: string, term: string): boolean {
  return domain.toLowerCase().includes(term.toLowerCase());
}

export function scoreCtObservation(options: {
  observedDomain: string;
  watchlistEntries: CtWatchlistEntry[];
}): ScoredCtAlert | null {
  const enabledEntries = options.watchlistEntries.filter((entry) => entry.enabled);
  const brandTerms = enabledEntries.filter((entry) => entry.watchType === "brand");
  const internalTerms = enabledEntries.filter((entry) => entry.watchType === "internal");
  const riskyKeywords = enabledEntries.filter((entry) => entry.watchType === "keyword");

  const matchedBrand = brandTerms.find((entry) => domainMatchesBrand(options.observedDomain, entry.term));
  const matchedInternal = internalTerms.find((entry) => domainContainsTerm(options.observedDomain, entry.term));
  const matchedKeywords = riskyKeywords.filter((entry) => domainContainsTerm(options.observedDomain, entry.term));

  if (matchedBrand && matchedKeywords.length > 0) {
    return {
      category: "phishing",
      severity: "high",
      matchedTerm: matchedBrand.term,
      watchType: matchedBrand.watchType,
      reasons: [
        "contains watched brand term",
        ...matchedKeywords.map((entry) => `contains risky keyword: ${entry.term}`),
      ],
    };
  }

  if (matchedInternal) {
    return {
      category: "shadow-it",
      severity: "high",
      matchedTerm: matchedInternal.term,
      watchType: matchedInternal.watchType,
      reasons: ["contains watched internal identifier"],
    };
  }

  if (matchedBrand) {
    return {
      category: "brand-protection",
      severity: "medium",
      matchedTerm: matchedBrand.term,
      watchType: matchedBrand.watchType,
      reasons: ["contains watched brand term"],
    };
  }

  return null;
}
