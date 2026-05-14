import { techDetectionRules } from "@/lib/tech-stack/rules";
import type {
  TechConfidence,
  TechDetectionResult,
  TechDetectionRule,
  TechMatcher,
  TechStackScanSignals,
} from "@/lib/tech-stack/types";

const CONFIDENCE_RANK: Record<TechConfidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

type MatchEvidence = {
  evidence: string[];
  source?: TechDetectionResult["source"];
};

export function evaluateTechStackSignals(
  signals: TechStackScanSignals,
  rules: TechDetectionRule[] = techDetectionRules,
) {
  const detections = new Map<string, TechDetectionResult>();

  for (const rule of rules) {
    const match = matchRule(rule.matcher, signals);
    if (!match) {
      continue;
    }

    const nextResult: TechDetectionResult = {
      id: rule.id,
      technology: rule.technology,
      category: rule.category,
      confidence: rule.confidence,
      source: match.source,
      evidence: match.evidence,
    };

    const existing = detections.get(rule.technology);
    if (!existing) {
      detections.set(rule.technology, nextResult);
      continue;
    }

    const shouldReplace =
      CONFIDENCE_RANK[nextResult.confidence] > CONFIDENCE_RANK[existing.confidence];
    const mergedEvidence = mergeEvidence(
      shouldReplace ? nextResult.evidence : existing.evidence,
      shouldReplace ? existing.evidence : nextResult.evidence,
    );

    detections.set(rule.technology, {
      ...(shouldReplace ? nextResult : existing),
      evidence: mergedEvidence,
    });
  }

  return Array.from(detections.values()).sort((left, right) => {
    return CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence];
  });
}

function matchRule(matcher: TechMatcher, signals: TechStackScanSignals): MatchEvidence | null {
  switch (matcher.type) {
    case "header-contains": {
      const value = signals.http.headers[matcher.header.toLowerCase()];
      if (value?.toLowerCase().includes(matcher.value.toLowerCase())) {
        return {
          source: "header",
          evidence: [`Header ${matcher.header.toLowerCase()} contained ${matcher.value}`],
        };
      }
      return null;
    }
    case "script-src-regex": {
      const pattern = new RegExp(matcher.pattern, "i");
      if (signals.http.scriptSrcs.some((scriptSrc) => pattern.test(scriptSrc))) {
        return {
          source: "script",
          evidence: [`Script source matched ${matcher.pattern}`],
        };
      }
      return null;
    }
    case "link-href-regex": {
      const pattern = new RegExp(matcher.pattern, "i");
      if (signals.http.linkHrefs.some((href) => pattern.test(href))) {
        return {
          source: "link",
          evidence: [`Link href matched ${matcher.pattern}`],
        };
      }
      return null;
    }
    case "html-regex": {
      const pattern = new RegExp(matcher.pattern, "i");
      if (pattern.test(signals.http.html)) {
        return {
          source: "html",
          evidence: [`HTML matched ${matcher.pattern}`],
        };
      }
      return null;
    }
    case "cookie-name": {
      if (signals.http.cookies.some((cookie) => cookie === matcher.cookieName)) {
        return {
          source: "cookie",
          evidence: [`Cookie ${matcher.cookieName} was present`],
        };
      }
      return null;
    }
    case "meta-generator-contains": {
      const generator = signals.http.meta.generator ?? "";
      if (generator.toLowerCase().includes(matcher.value.toLowerCase())) {
        return {
          source: "meta",
          evidence: [`Meta generator contained ${matcher.value}`],
        };
      }
      return null;
    }
    case "dns-pattern": {
      const pattern = new RegExp(matcher.pattern, "i");
      if (signals.dns[matcher.recordType].some((record) => pattern.test(record))) {
        return {
          source: "dns",
          evidence: [`DNS ${matcher.recordType} matched ${matcher.pattern}`],
        };
      }
      return null;
    }
    case "security-header-present": {
      if (Boolean(signals.http.headers[matcher.header])) {
        return {
          source: "security",
          evidence: [`Security header ${matcher.header} was present`],
        };
      }
      return null;
    }
    case "combined": {
      const matches = matcher.matchers
        .map((childMatcher) => matchRule(childMatcher, signals))
        .filter((match): match is MatchEvidence => match !== null);

      if (matches.length !== matcher.matchers.length) {
        return null;
      }

      return {
        source: matches[0]?.source,
        evidence: mergeEvidence(...matches.map((match) => match.evidence)),
      };
    }
  }
}

function mergeEvidence(...groups: string[][]) {
  return Array.from(new Set(groups.flat()));
}
