// @vitest-environment node

import { scoreCtObservation } from "./src/matcher";
import { parseCtRawLine } from "./src/parser";
import { ClickHouseCtTransformRepository } from "./src/repository";
import { transformCtImport } from "./src/transformer";

describe("ct transform", () => {
  it("extracts hostnames from JSON CT lines", () => {
    const line = JSON.stringify({
      dns_names: ["secure-openai-login.net", "api.example.com"],
      issuer_name: "Let's Encrypt",
    });

    expect(parseCtRawLine(line)).toEqual({
      parseMode: "json",
      issuerName: "Let's Encrypt",
      notBefore: null,
      notAfter: null,
      domains: ["secure-openai-login.net", "api.example.com"],
    });
  });

  it("falls back to plain-line parsing when a line is a single hostname", () => {
    expect(parseCtRawLine("vpn-admin.internal-example.net")).toEqual({
      parseMode: "plain",
      issuerName: null,
      notBefore: null,
      notAfter: null,
      domains: ["vpn-admin.internal-example.net"],
    });
  });

  it("does not throw on malformed JSON-like lines and skips invalid observations", async () => {
    const repository = {
      ensureSchema: vi.fn(),
      streamRawLines: vi.fn().mockImplementation(async (_importVersion, onRows) => {
        await onRows([
          {
            dumpDate: "2025-11-24",
            rawLine: '{"dns_names":["broken.example.com"',
            rawLineSha256: "badjson",
          },
          {
            dumpDate: "2025-11-24",
            rawLine: JSON.stringify({
              dns_names: ["secure-openai-login.net"],
              issuer_name: "Let's Encrypt",
            }),
            rawLineSha256: "goodjson",
          },
        ]);
      }),
      listWatchlistEntries: vi.fn().mockResolvedValue([
        { entryId: "1", watchType: "brand", term: "openai", enabled: true },
        { entryId: "2", watchType: "keyword", term: "login", enabled: true },
      ]),
      writeObservations: vi.fn(),
      writeAlerts: vi.fn(),
      activateCtAlertLoad: vi.fn(),
    };

    const result = await transformCtImport({
      dumpDate: "2025-11-24",
      importVersion: "ct-import-2025-11-24",
      repository,
      createLoadVersion: () => "ct-load-1",
    });

    expect(result.observationCount).toBe(1);
    expect(result.alertCount).toBe(1);
    expect(repository.writeObservations).toHaveBeenCalledWith({
      loadVersion: "ct-load-1",
      observations: [
        expect.objectContaining({
          observedDomain: "secure-openai-login.net",
          rawLineSha256: "goodjson",
        }),
      ],
    });
  });

  it("creates a high-severity phishing alert for a watched brand plus risky keyword", () => {
    const alert = scoreCtObservation({
      observedDomain: "secure-openai-login.net",
      watchlistEntries: [
        { entryId: "1", watchType: "brand", term: "openai", enabled: true },
        { entryId: "2", watchType: "keyword", term: "login", enabled: true },
        { entryId: "3", watchType: "keyword", term: "secure", enabled: true },
      ],
    });

    expect(alert).toEqual({
      category: "phishing",
      severity: "high",
      matchedTerm: "openai",
      watchType: "brand",
      reasons: expect.arrayContaining([
        "contains watched brand term",
        "contains risky keyword: login",
      ]),
    });
  });

  it("writes parsed observations and alerts and activates the CT load", async () => {
    const repository = {
      ensureSchema: vi.fn(),
      streamRawLines: vi.fn().mockImplementation(async (_importVersion, onRows) => {
        await onRows([
          {
            dumpDate: "2025-11-24",
            rawLine: JSON.stringify({
              dns_names: ["secure-openai-login.net"],
              issuer_name: "Let's Encrypt",
            }),
            rawLineSha256: "abc123",
          },
        ]);
      }),
      listWatchlistEntries: vi.fn().mockResolvedValue([
        { entryId: "1", watchType: "brand", term: "openai", enabled: true },
        { entryId: "2", watchType: "keyword", term: "login", enabled: true },
      ]),
      writeObservations: vi.fn(),
      writeAlerts: vi.fn(),
      activateCtAlertLoad: vi.fn(),
    };

    const result = await transformCtImport({
      dumpDate: "2025-11-24",
      importVersion: "ct-import-2025-11-24",
      repository,
      createLoadVersion: () => "ct-load-1",
    });

    expect(repository.writeObservations).toHaveBeenCalled();
    expect(repository.writeAlerts).toHaveBeenCalledWith({
      loadVersion: "ct-load-1",
      alerts: [
        expect.objectContaining({
          domain: "secure-openai-login.net",
          rawLineSha256: "abc123",
        }),
      ],
    });
    expect(repository.activateCtAlertLoad).toHaveBeenCalledWith({
      loadVersion: "ct-load-1",
      dumpDate: "2025-11-24",
    });
    expect(result.alertCount).toBe(1);
  });

  it("processes CT raw lines in streamed batches instead of one full in-memory array", async () => {
    const repository = {
      ensureSchema: vi.fn(),
      streamRawLines: vi.fn().mockImplementation(async (_importVersion, onRows) => {
        await onRows([
          {
            dumpDate: "2025-11-24",
            rawLine: JSON.stringify({
              dns_names: ["secure-openai-login.net"],
            }),
            rawLineSha256: "raw-1",
          },
        ]);
        await onRows([
          {
            dumpDate: "2025-11-24",
            rawLine: JSON.stringify({
              dns_names: ["vpn-admin.internal-example.net"],
            }),
            rawLineSha256: "raw-2",
          },
        ]);
      }),
      listWatchlistEntries: vi.fn().mockResolvedValue([
        { entryId: "1", watchType: "brand", term: "openai", enabled: true },
        { entryId: "2", watchType: "keyword", term: "login", enabled: true },
      ]),
      writeObservations: vi.fn(),
      writeAlerts: vi.fn(),
      activateCtAlertLoad: vi.fn(),
    };

    const result = await transformCtImport({
      dumpDate: "2025-11-24",
      importVersion: "ct-import-2025-11-24",
      repository,
      createLoadVersion: () => "ct-load-1",
    });

    expect(repository.streamRawLines).toHaveBeenCalledWith(
      "ct-import-2025-11-24",
      expect.any(Function),
    );
    expect(repository.writeObservations).toHaveBeenCalledTimes(2);
    expect(result.observationCount).toBe(2);
  });

  it("reads watchlist entries from the latest replacing rows", async () => {
    const query = vi.fn().mockResolvedValue({
      json: async () => [
        {
          entry_id: "entry-1",
          watch_type: "brand",
          term: "OpenAI",
          enabled: true,
        },
      ],
    });

    const repository = new ClickHouseCtTransformRepository({
      client: {
        command: vi.fn(),
        insert: vi.fn(),
        query,
      },
    });

    const rows = await repository.listWatchlistEntries();

    expect(rows).toEqual([
      {
        entryId: "entry-1",
        watchType: "brand",
        term: "openai",
        enabled: true,
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("FINAL"),
      }),
    );
  });

  it("persists the original raw-line hash into the alert feed", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const repository = new ClickHouseCtTransformRepository({
      client: {
        command: vi.fn(),
        insert,
        query: vi.fn(),
      },
    });

    await repository.writeAlerts({
      loadVersion: "ct-load-1",
      alerts: [
        {
          id: "alert-1",
          observedAt: "2025-11-24",
          domain: "secure-openai-login.net",
          category: "phishing",
          severity: "high",
          watchType: "brand",
          matchedTerm: "openai",
          reasons: ["contains watched brand term"],
          issuerName: "Let's Encrypt",
          rawLineSha256: "raw-hash-123",
        },
      ],
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "ct_alert_feed",
        values: [
          expect.objectContaining({
            alert_id: "alert-1",
            raw_line_sha256: "raw-hash-123",
          }),
        ],
      }),
    );
  });
});
