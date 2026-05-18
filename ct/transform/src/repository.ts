import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";

import type { CtAlertFeedRow, CtDomainObservationRecord, CtWatchlistEntry } from "@/ct/types";
import { deriveDomainParts } from "@/bulk/transform/src/repository";

type ClickHouseClientLike = Pick<ClickHouseClient, "command" | "query" | "insert">;

const DEFAULT_SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../schema/clickhouse-ct.sql",
);

function splitSqlStatements(sqlText: string) {
  return sqlText
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function readRows<T extends Record<string, unknown>>(
  client: ClickHouseClientLike,
  query: string,
  queryParams?: Record<string, unknown>,
): Promise<T[]> {
  const resultSet = await client.query({
    query,
    query_params: queryParams,
    format: "JSONEachRow",
  });

  return (await resultSet.json()) as T[];
}

type CtRawLineRow = {
  dumpDate: string;
  rawLine: string;
  rawLineSha256: string;
};

export class ClickHouseCtTransformRepository {
  private readonly client: ClickHouseClientLike;
  private readonly schemaPath: string;
  private schemaRegistered = false;

  constructor(options: { client: ClickHouseClientLike; schemaPath?: string }) {
    this.client = options.client;
    this.schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
  }

  async ensureSchema() {
    if (this.schemaRegistered) {
      return;
    }

    const schemaSql = await readFile(this.schemaPath, "utf8");

    for (const statement of splitSqlStatements(schemaSql)) {
      await this.client.command({
        query: statement,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      });
    }

    this.schemaRegistered = true;
  }

  async streamRawLines(
    importVersion: string,
    onRows: (rows: CtRawLineRow[]) => Promise<void>,
  ): Promise<void> {
    const resultSet = await this.client.query({
      query: `
        SELECT
          toString(dump_date) AS dump_date,
          raw_line,
          raw_line_sha256
        FROM ct_log_line_raw
        WHERE import_version = {import_version: String}
        ORDER BY source_line_number ASC
      `,
      query_params: { import_version: importVersion },
      format: "JSONEachRow",
    });

    for await (const chunk of resultSet.stream<Record<string, unknown>>()) {
      await onRows(
        chunk.map((row) => {
          const payload = row.json<Record<string, unknown>>();

          return {
            dumpDate: String(payload.dump_date),
            rawLine: String(payload.raw_line),
            rawLineSha256: String(payload.raw_line_sha256),
          };
        }),
      );
    }
  }

  async listWatchlistEntries(): Promise<CtWatchlistEntry[]> {
    const rows = await readRows<Record<string, unknown>>(
      this.client,
      `
        SELECT
          toString(entry_id) AS entry_id,
          watch_type,
          term,
          enabled
        FROM ct_watchlist_entry FINAL
        WHERE enabled = true
      `,
    );

    return rows.map((row) => ({
      entryId: String(row.entry_id),
      watchType: String(row.watch_type) as CtWatchlistEntry["watchType"],
      term: String(row.term).toLowerCase(),
      enabled: Boolean(row.enabled),
    }));
  }

  async writeObservations(params: {
    loadVersion: string;
    observations: CtDomainObservationRecord[];
  }) {
    if (params.observations.length === 0) {
      return;
    }

    await this.client.insert({
      table: "ct_domain_observation",
      values: params.observations.map((row) => ({
        load_version: params.loadVersion,
        dump_date: row.dumpDate,
        observed_domain: row.observedDomain,
        registrable_domain: row.registrableDomain,
        first_label: row.firstLabel,
        watch_parse_mode: row.parseMode,
        issuer_name: row.issuerName,
        not_before: row.notBefore,
        not_after: row.notAfter,
        raw_line_sha256: row.rawLineSha256,
      })),
      format: "JSONEachRow",
    });
  }

  async writeAlerts(params: {
    loadVersion: string;
    alerts: CtAlertFeedRow[];
  }) {
    if (params.alerts.length === 0) {
      return;
    }

    await this.client.insert({
      table: "ct_alert_feed",
      values: params.alerts.map((row) => ({
        load_version: params.loadVersion,
        alert_id: row.id,
        dump_date: row.observedAt,
        domain: row.domain,
        category: row.category,
        severity: row.severity,
        watch_type: row.watchType,
        matched_term: row.matchedTerm,
        reasons: row.reasons,
        issuer_name: row.issuerName ?? null,
        raw_line_sha256: row.rawLineSha256,
      })),
      format: "JSONEachRow",
    });
  }

  async activateCtAlertLoad(params: { loadVersion: string; dumpDate: string }) {
    await this.client.command({
      query: `
        INSERT INTO ct_runtime_state_events
        (
          state_key,
          load_version,
          dump_date,
          recorded_at
        )
        VALUES
        (
          'ct_alert_feed',
          {load_version: String},
          {dump_date: Date},
          now64(3)
        )
      `,
      query_params: {
        load_version: params.loadVersion,
        dump_date: params.dumpDate,
      },
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
  }
}

export function buildObservationRecord(options: {
  dumpDate: string;
  observedDomain: string;
  parseMode: CtDomainObservationRecord["parseMode"];
  issuerName: string | null;
  notBefore: string | null;
  notAfter: string | null;
  rawLineSha256: string;
}): CtDomainObservationRecord {
  const domainParts = deriveDomainParts(options.observedDomain);
  return {
    dumpDate: options.dumpDate,
    observedDomain: options.observedDomain,
    registrableDomain: domainParts.apexDomain,
    firstLabel: domainParts.firstLabel,
    parseMode: options.parseMode,
    issuerName: options.issuerName,
    notBefore: options.notBefore,
    notAfter: options.notAfter,
    rawLineSha256: options.rawLineSha256,
  };
}

export function createCtLoadVersion() {
  return randomUUID();
}
