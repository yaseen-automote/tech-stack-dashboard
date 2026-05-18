export type CtWatchType = "brand" | "internal" | "keyword";

export type CtAlertCategory = "phishing" | "brand-protection" | "shadow-it";

export type CtAlertSeverity = "high" | "medium";

export type CtLineParseMode = "json" | "tsv" | "plain";

export type CtDumpIndexEntry = {
  dumpDate: string;
  fileName: string;
};

export type CtFetchManifest = {
  dumpDate: string;
  source: {
    sourceUrl: string;
    gzipPath: string;
    sizeBytes: number;
    checksum: {
      algorithm: "sha256";
      value: string;
    };
  };
};

export type CtWatchlistEntry = {
  entryId: string;
  watchType: CtWatchType;
  term: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ParsedCtLine = {
  parseMode: CtLineParseMode;
  issuerName: string | null;
  notBefore: string | null;
  notAfter: string | null;
  domains: string[];
};

export type ScoredCtAlert = {
  category: CtAlertCategory;
  severity: CtAlertSeverity;
  matchedTerm: string;
  watchType: CtWatchType;
  reasons: string[];
};

export type CtDomainObservationRecord = {
  dumpDate: string;
  observedDomain: string;
  registrableDomain: string;
  firstLabel: string;
  parseMode: CtLineParseMode;
  issuerName: string | null;
  notBefore: string | null;
  notAfter: string | null;
  rawLineSha256: string;
};

export type CtAlertFeedRow = {
  id: string;
  observedAt: string;
  domain: string;
  category: CtAlertCategory;
  severity: CtAlertSeverity;
  watchType: CtWatchType;
  matchedTerm: string;
  reasons: string[];
  issuerName?: string | null;
  rawLineSha256: string;
};

export type CtAlertSummary = {
  newestDumpDate: string | null;
  totals: {
    alerts: number;
    phishing: number;
    brandProtection: number;
    shadowIt: number;
    highSeverity: number;
  };
};
