import { createHash } from "node:crypto";

import type { CtAlertFeedRow } from "@/ct/types";
import { normalizeDomainInput } from "@/lib/subdomain-intelligence";
import { scoreCtObservation } from "./matcher";
import { parseCtRawLine } from "./parser";
import {
  buildObservationRecord,
  createCtLoadVersion,
  ClickHouseCtTransformRepository,
} from "./repository";

export async function transformCtImport(options: {
  dumpDate: string;
  importVersion: string;
  repository: Pick<
    ClickHouseCtTransformRepository,
    | "ensureSchema"
    | "streamRawLines"
    | "listWatchlistEntries"
    | "writeObservations"
    | "writeAlerts"
    | "activateCtAlertLoad"
  >;
  createLoadVersion?: () => string;
}) {
  await options.repository.ensureSchema();

  const watchlistEntries = await options.repository.listWatchlistEntries();

  const loadVersion = options.createLoadVersion?.() ?? createCtLoadVersion();
  let observationCount = 0;
  let alertCount = 0;

  await options.repository.streamRawLines(options.importVersion, async (rawRows) => {
    const observations = rawRows.flatMap((row) => {
      const parsed = parseCtRawLine(row.rawLine);
      return parsed.domains.map((domain) =>
        buildObservationRecord({
          dumpDate: row.dumpDate,
          observedDomain: normalizeDomainInput(domain),
          parseMode: parsed.parseMode,
          issuerName: parsed.issuerName,
          notBefore: parsed.notBefore,
          notAfter: parsed.notAfter,
          rawLineSha256: row.rawLineSha256,
        }),
      );
    });

    const alerts: CtAlertFeedRow[] = observations.flatMap((observation) => {
      const scored = scoreCtObservation({
        observedDomain: observation.observedDomain,
        watchlistEntries,
      });

      if (!scored) {
        return [];
      }

      return [
        {
          id: createHash("sha256")
            .update(
              `${observation.dumpDate}:${observation.observedDomain}:${scored.category}:${scored.matchedTerm}`,
            )
            .digest("hex"),
          observedAt: observation.dumpDate,
          domain: observation.observedDomain,
          category: scored.category,
          severity: scored.severity,
          watchType: scored.watchType,
          matchedTerm: scored.matchedTerm,
          reasons: scored.reasons,
          issuerName: observation.issuerName,
          rawLineSha256: observation.rawLineSha256,
        },
      ];
    });

    observationCount += observations.length;
    alertCount += alerts.length;

    await options.repository.writeObservations({
      loadVersion,
      observations,
    });
    await options.repository.writeAlerts({
      loadVersion,
      alerts,
    });
  });

  await options.repository.activateCtAlertLoad({
    loadVersion,
    dumpDate: options.dumpDate,
  });

  return {
    loadVersion,
    observationCount,
    alertCount,
  };
}
