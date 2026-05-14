export type TechCategory =
  | "Frontend / UI"
  | "Framework / Runtime"
  | "Analytics / Tag Manager"
  | "Payments / Widgets"
  | "CDN / WAF"
  | "Hosting / Cloud"
  | "DNS / Mail / Security"
  | "CMS / Metadata";

export type TechConfidence = "high" | "medium" | "low";

export type NormalizedTechStackTarget = {
  rawInput: string;
  canonicalHostname: string;
  normalizedUrl: string;
  displayTarget: string;
};

export type TechMatcher =
  | {
      type: "header-contains";
      header: string;
      value: string;
    }
  | {
      type: "script-src-regex";
      pattern: string;
    }
  | {
      type: "link-href-regex";
      pattern: string;
    }
  | {
      type: "html-regex";
      pattern: string;
    }
  | {
      type: "cookie-name";
      cookieName: string;
    }
  | {
      type: "meta-generator-contains";
      value: string;
    }
  | {
      type: "dns-pattern";
      recordType: keyof TechStackScanSignals["dns"];
      pattern: string;
    }
  | {
      type: "security-header-present";
      header: "content-security-policy" | "strict-transport-security" | "x-frame-options" | "x-content-type-options" | "referrer-policy";
    }
  | {
      type: "combined";
      matchers: Exclude<TechMatcher, { type: "combined" }>[];
    };

export type TechDetectionRule = {
  id: string;
  technology: string;
  category: TechCategory;
  confidence: TechConfidence;
  matcher: TechMatcher;
};

export type TechDetectionResult = {
  id: string;
  technology: string;
  category: TechCategory;
  confidence: TechConfidence;
  evidence: string[];
  source?: "header" | "script" | "link" | "html" | "cookie" | "meta" | "dns" | "security";
};

export type TechStackProbeResult = {
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

export type TechStackScanSignals = {
  input: {
    rawInput: string;
    canonicalHostname: string;
    normalizedUrl: string;
    finalUrl?: string;
  };
  http: {
    status?: number;
    headers: Record<string, string>;
    cookies: string[];
    html: string;
    scriptSrcs: string[];
    inlineScripts: string[];
    linkHrefs: string[];
    meta: Record<string, string>;
  };
  probes: Record<string, TechStackProbeResult>;
  dns: {
    ns: string[];
    mx: string[];
    txt: string[];
    cname: string[];
  };
  security: {
    csp: boolean;
    hsts: boolean;
    xFrameOptions: boolean;
    xContentTypeOptions: boolean;
    referrerPolicy: boolean;
  };
};
