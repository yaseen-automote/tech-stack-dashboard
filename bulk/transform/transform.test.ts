// @vitest-environment node

import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  ClickHouseBulkTransformRepository,
  deriveDomainParts,
} from "./src/repository";
import { transformImportedSnapshot } from "./src/transformer";
import type { BulkTransformRepository } from "./src/types";

type MockBulkTransformRepository = {
  [Key in keyof BulkTransformRepository]: ReturnType<typeof vi.fn>;
};

function createRepository(): MockBulkTransformRepository {
  return {
    ensureSchema: vi.fn().mockResolvedValue(undefined),
    findReadyTransformBySourceKey: vi.fn().mockResolvedValue(null),
    registerTransformStart: vi.fn().mockResolvedValue(undefined),
    transformImportIntoServing: vi.fn().mockResolvedValue(0),
    markTransformReady: vi.fn().mockResolvedValue(undefined),
    markTransformFailed: vi.fn().mockResolvedValue(undefined),
    activateLoad: vi.fn().mockResolvedValue(undefined),
  };
}

type MockQueryResult = {
  json: <T>() => Promise<T>;
};

class MockClickHouseClient {
  readonly commandCalls: Array<Record<string, unknown>> = [];
  readonly queryCalls: Array<Record<string, unknown>> = [];
  readonly queryResponses: unknown[] = [];

  async command(params: Record<string, unknown>) {
    this.commandCalls.push(params);
    return { query_id: `command-${this.commandCalls.length}` };
  }

  async query(params: Record<string, unknown>): Promise<MockQueryResult> {
    this.queryCalls.push(params);
    const response = this.queryResponses.shift();

    return {
      json: async <T>() => response as T,
    };
  }

  async exec() {
    const stream = new PassThrough();
    stream.end();

    return {
      stream,
      query_id: "exec-1",
    };
  }
}

describe("transformImportedSnapshot", () => {
  it("reuses a ready transform by source key and activates its load version", async () => {
    const repository = createRepository();

    repository.findReadyTransformBySourceKey.mockResolvedValue({
      loadVersion: "load-2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-04",
      rowCount: 12,
    });

    const result = await transformImportedSnapshot({
      snapshotMonth: "2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      repository: repository as unknown as BulkTransformRepository,
      createLoadVersion: () => "load-unused",
    });

    expect(result).toEqual({
      loadVersion: "load-2026-04",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-04",
      rowCount: 12,
    });
    expect(repository.registerTransformStart).not.toHaveBeenCalled();
    expect(repository.transformImportIntoServing).not.toHaveBeenCalled();
    expect(repository.markTransformReady).not.toHaveBeenCalled();
    expect(repository.markTransformFailed).not.toHaveBeenCalled();
    expect(repository.activateLoad).toHaveBeenCalledWith({
      loadVersion: "load-2026-04",
      snapshotMonth: "2026-04",
    });
  });

  it("fails loudly when a ready transform does not match the requested import context", async () => {
    const repository = createRepository();

    repository.findReadyTransformBySourceKey.mockResolvedValue({
      loadVersion: "load-2026-03",
      importVersion: "import-2026-03",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-03",
      rowCount: 12,
    });

    await expect(
      transformImportedSnapshot({
        snapshotMonth: "2026-04",
        importVersion: "import-2026-04",
        sourceKey: "2026-04:abc",
        repository: repository as unknown as BulkTransformRepository,
        createLoadVersion: () => "load-unused",
      }),
    ).rejects.toThrow(/ready transform .* does not match requested snapshot\/import context/i);

    expect(repository.activateLoad).not.toHaveBeenCalled();
    expect(repository.registerTransformStart).not.toHaveBeenCalled();
  });

  it("keeps the active load unchanged when the transform fails", async () => {
    const repository = createRepository();

    repository.findReadyTransformBySourceKey.mockResolvedValue(null);
    repository.transformImportIntoServing.mockRejectedValue(new Error("bad raw row"));

    await expect(
      transformImportedSnapshot({
        snapshotMonth: "2026-04",
        importVersion: "import-2026-04",
        sourceKey: "2026-04:abc",
        repository: repository as unknown as BulkTransformRepository,
        createLoadVersion: () => "load-2026-04",
      }),
    ).rejects.toThrow("bad raw row");

    expect(repository.activateLoad).not.toHaveBeenCalled();
    expect(repository.markTransformFailed).toHaveBeenCalledWith({
      loadVersion: "load-2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-04",
      errorMessage: "bad raw row",
    });
  });

  it("marks the transform ready and activates the load after a successful transform", async () => {
    const repository = createRepository();

    repository.transformImportIntoServing.mockResolvedValue(7);

    const result = await transformImportedSnapshot({
      snapshotMonth: "2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      repository: repository as unknown as BulkTransformRepository,
      createLoadVersion: () => "load-2026-04",
    });

    expect(repository.registerTransformStart).toHaveBeenCalledWith({
      loadVersion: "load-2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-04",
    });
    expect(repository.transformImportIntoServing).toHaveBeenCalledWith({
      loadVersion: "load-2026-04",
      importVersion: "import-2026-04",
      snapshotMonth: "2026-04",
    });
    expect(repository.markTransformReady).toHaveBeenCalledWith({
      loadVersion: "load-2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-04",
      rowCount: 7,
    });
    expect(repository.activateLoad).toHaveBeenCalledWith({
      loadVersion: "load-2026-04",
      snapshotMonth: "2026-04",
    });
    expect(result).toEqual({
      loadVersion: "load-2026-04",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-04",
      rowCount: 7,
    });
  });
});

describe("ClickHouseBulkTransformRepository", () => {
  it("finds the latest ready transform by source key", async () => {
    const client = new MockClickHouseClient();
    client.queryResponses.push([
      {
        load_version: "load-2026-04",
        import_version: "import-2026-04",
        source_key: "2026-04:abc",
        snapshot_month: "2026-04",
        row_count: "9",
      },
    ]);
    const repository = new ClickHouseBulkTransformRepository({ client });

    await expect(repository.findReadyTransformBySourceKey("2026-04:abc")).resolves.toEqual({
      loadVersion: "load-2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-04",
      rowCount: 9,
    });
    expect(client.queryCalls[0]).toEqual(
      expect.objectContaining({
        query: expect.stringContaining("FROM bulk_transform_attempts_latest"),
        query_params: {
          source_key: "2026-04:abc",
        },
        format: "JSONEachRow",
      }),
    );
  });

  it("transforms imported raw rows into serving rows and counts the load rows", async () => {
    const client = new MockClickHouseClient();
    client.queryResponses.push([{ row_count: "11" }]);
    const repository = new ClickHouseBulkTransformRepository({ client });

    await expect(
      repository.transformImportIntoServing({
        loadVersion: "load-2026-04",
        importVersion: "import-2026-04",
        snapshotMonth: "2026-04",
      }),
    ).resolves.toBe(11);

    expect(client.commandCalls[0]).toEqual(
      expect.objectContaining({
        query: expect.stringContaining("INSERT INTO bulk_hostname_serving"),
        query_params: {
          load_version: "load-2026-04",
          import_version: "import-2026-04",
          snapshot_month: "2026-04",
        },
      }),
    );
    expect(String(client.commandCalls[0]?.query)).toContain("FROM bulk_hostname_raw");
    expect(String(client.commandCalls[0]?.query)).toContain(
      "NULLIF(trim(BOTH ' ' FROM raw_hostname), '')",
    );
    expect(String(client.commandCalls[0]?.query)).toContain(
      "NULLIF(trim(BOTH ' ' FROM raw_ip_address), '')",
    );
    expect(String(client.commandCalls[0]?.query)).toContain("match(");
    expect(String(client.commandCalls[0]?.query)).toContain("WHEN hostname LIKE '%.co.uk'");
    expect(String(client.commandCalls[0]?.query)).toContain(
      "NULLIF(trim(BOTH ' ' FROM raw_provider_hint), '') AS provider_hint",
    );
    expect(String(client.commandCalls[0]?.query)).not.toContain("lowerUTF8(trim(BOTH ' ' FROM raw_provider_hint))");
    expect(client.queryCalls[0]).toEqual(
      expect.objectContaining({
        query: expect.stringContaining("FROM bulk_hostname_serving"),
        query_params: {
          load_version: "load-2026-04",
        },
        format: "JSONEachRow",
      }),
    );
  });

  it("preserves multi-label public suffix handling for domains like example.co.uk", () => {
    expect(deriveDomainParts("api.example.co.uk")).toEqual({
      apexDomain: "example.co.uk",
      tld: "co.uk",
      firstLabel: "api",
    });
  });

  it("filters trimmed-empty raw hostname and ip rows after trimming in the transform sql", async () => {
    const client = new MockClickHouseClient();
    client.queryResponses.push([{ row_count: "0" }]);
    const repository = new ClickHouseBulkTransformRepository({ client });

    await repository.transformImportIntoServing({
      loadVersion: "load-2026-04",
      importVersion: "import-2026-04",
      snapshotMonth: "2026-04",
    });

    const query = String(client.commandCalls[0]?.query);

    expect(query).not.toContain("raw_hostname != ''");
    expect(query).not.toContain("raw_ip_address != ''");
    expect(query).toContain("WHERE rejection_reason IS NULL");
  });

  it("records transforming, ready, failed, and activation events", async () => {
    const client = new MockClickHouseClient();
    const repository = new ClickHouseBulkTransformRepository({ client });

    await repository.registerTransformStart({
      loadVersion: "load-2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-04",
    });
    await repository.markTransformReady({
      loadVersion: "load-2026-04",
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc",
      snapshotMonth: "2026-04",
      rowCount: 11,
    });
    await repository.markTransformFailed({
      loadVersion: "load-2026-05",
      importVersion: "import-2026-05",
      sourceKey: "2026-05:def",
      snapshotMonth: "2026-05",
      errorMessage: "bad raw row",
    });
    await repository.activateLoad({
      loadVersion: "load-2026-04",
      snapshotMonth: "2026-04",
    });

    expect(client.commandCalls).toHaveLength(4);
    expect(client.commandCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          query: expect.stringContaining("INSERT INTO bulk_transform_attempt_events"),
          query_params: expect.objectContaining({
            load_version: "load-2026-04",
            import_version: "import-2026-04",
            source_key: "2026-04:abc",
            snapshot_month: "2026-04",
            status: "transforming",
            row_count: 0,
            error_message: null,
          }),
        }),
        expect.objectContaining({
          query: expect.stringContaining("INSERT INTO bulk_transform_attempt_events"),
          query_params: expect.objectContaining({
            load_version: "load-2026-04",
            import_version: "import-2026-04",
            source_key: "2026-04:abc",
            snapshot_month: "2026-04",
            status: "ready",
            row_count: 11,
            error_message: null,
          }),
        }),
        expect.objectContaining({
          query: expect.stringContaining("INSERT INTO bulk_transform_attempt_events"),
          query_params: expect.objectContaining({
            load_version: "load-2026-05",
            import_version: "import-2026-05",
            source_key: "2026-05:def",
            snapshot_month: "2026-05",
            status: "failed",
            row_count: 0,
            error_message: "bad raw row",
          }),
        }),
        expect.objectContaining({
          query: expect.stringContaining("INSERT INTO bulk_runtime_state_events"),
          query_params: expect.objectContaining({
            state_key: "hostname_serving",
            load_version: "load-2026-04",
            snapshot_month: "2026-04",
          }),
        }),
      ]),
    );
  });
});
