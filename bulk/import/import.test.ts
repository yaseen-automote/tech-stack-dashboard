// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { importSnapshotToClickHouse } from "./src/importer";
import * as manifestModule from "./src/manifest";
import { ClickHouseBulkImportRepository } from "./src/repository";
import type { BulkImportRepository } from "./src/types";

type MockBulkImportRepository = {
  [Key in keyof BulkImportRepository]: ReturnType<typeof vi.fn>;
};

async function withTempDir(run: (tempDir: string) => Promise<void>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bulk-import-test-"));

  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function createRepository(): MockBulkImportRepository {
  return {
    ensureSchema: vi.fn().mockResolvedValue(undefined),
    registerImportStart: vi.fn().mockResolvedValue(undefined),
    importRawRowsFromParquet: vi.fn().mockResolvedValue({ rowCount: 0 }),
    markImportReady: vi.fn().mockResolvedValue(undefined),
    markImportFailed: vi.fn().mockResolvedValue(undefined),
  };
}

type MockQueryResult = {
  json: <T>() => Promise<T>;
};

class MockClickHouseClient {
  readonly commandCalls: Array<Record<string, unknown>> = [];
  readonly execCalls: Array<Record<string, unknown>> = [];
  readonly queryCalls: Array<Record<string, unknown>> = [];
  readonly queryResponses: unknown[] = [];

  async command(params: Record<string, unknown>) {
    this.commandCalls.push(params);
    return { query_id: "command-1" };
  }

  async exec(params: Record<string, unknown>) {
    this.execCalls.push(params);
    const stream = new PassThrough();
    stream.end();

    return {
      stream,
      query_id: "exec-1",
    };
  }

  async query(params: Record<string, unknown>): Promise<MockQueryResult> {
    this.queryCalls.push(params);
    const response = this.queryResponses.shift();

    return {
      json: async <T>() => response as T,
    };
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("importSnapshotToClickHouse", () => {
  it("fails before ClickHouse writes when the parquet path is missing", async () => {
    await withTempDir(async (tempDir) => {
      const manifestPath = path.join(tempDir, "monthly-manifest.json");
      const missingParquetPath = path.join(tempDir, "missing-snapshot.parquet");
      const repository = createRepository();

      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            snapshotMonth: "2026-04",
            snapshotId: "snapshot-2026-04",
            source: {
              parquetPath: missingParquetPath,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      await expect(
        importSnapshotToClickHouse({
          manifestPath,
          repository: repository as BulkImportRepository,
        }),
      ).rejects.toThrow(/missing-snapshot\.parquet/);

      expect(repository.registerImportStart).not.toHaveBeenCalled();
    });
  });

  it("records a ready import after streaming parquet into the raw table", async () => {
    await withTempDir(async (tempDir) => {
      const manifestPath = path.join(tempDir, "monthly-manifest.json");
      const parquetPath = path.join(tempDir, "snapshot.parquet");
      const repository = createRepository();

      repository.importRawRowsFromParquet.mockResolvedValue({ rowCount: 2 });

      await writeFile(parquetPath, "parquet bytes", "utf8");
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            snapshotMonth: "2026-04",
            snapshotId: "snapshot-2026-04",
            source: {
              parquetPath,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const result = await importSnapshotToClickHouse({
        manifestPath,
        repository: repository as BulkImportRepository,
        createImportVersion: () => "import-2026-04",
      });

      expect(repository.registerImportStart).toHaveBeenCalled();
      expect(repository.markImportReady).toHaveBeenCalledWith(
        expect.objectContaining({
          importVersion: "import-2026-04",
          snapshotMonth: "2026-04",
          rowCount: 2,
        }),
      );
      expect(result.rowCount).toBe(2);
    });
  });

  it("marks the import failed when parquet streaming fails after the start event", async () => {
    await withTempDir(async (tempDir) => {
      const manifestPath = path.join(tempDir, "monthly-manifest.json");
      const parquetPath = path.join(tempDir, "snapshot.parquet");
      const repository = createRepository();
      const parquetBytes = "parquet bytes";
      const expectedSha256 = createHash("sha256")
        .update(parquetBytes)
        .digest("hex");
      const expectedSourceKey = `2026-04:${expectedSha256}:${Buffer.byteLength(parquetBytes)}`;

      repository.importRawRowsFromParquet.mockRejectedValue(
        new Error("simulated import failure"),
      );

      await writeFile(parquetPath, parquetBytes, "utf8");
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            snapshotMonth: "2026-04",
            snapshotId: "snapshot-2026-04",
            source: {
              parquetPath,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      await expect(
        importSnapshotToClickHouse({
          manifestPath,
          repository: repository as BulkImportRepository,
          createImportVersion: () => "import-2026-04",
        }),
      ).rejects.toThrow(/simulated import failure/i);

      expect(repository.registerImportStart).toHaveBeenCalledWith(
        expect.objectContaining({
          importVersion: "import-2026-04",
          snapshotMonth: "2026-04",
          sourceKey: expectedSourceKey,
          sourceParquetPath: parquetPath,
          sourceFileBytes: Buffer.byteLength(parquetBytes),
          sourceFileSha256: expectedSha256,
        }),
      );
      expect(repository.markImportFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          importVersion: "import-2026-04",
          snapshotMonth: "2026-04",
          sourceKey: expectedSourceKey,
          sourceParquetPath: parquetPath,
          sourceFileBytes: Buffer.byteLength(parquetBytes),
          sourceFileSha256: expectedSha256,
          errorMessage: "simulated import failure",
        }),
      );
      expect(repository.markImportReady).not.toHaveBeenCalled();
    });
  });

  it("builds sourceKey from verified source metadata", async () => {
    await withTempDir(async (tempDir) => {
      const manifestPath = path.join(tempDir, "monthly-manifest.json");
      const parquetPath = path.join(tempDir, "snapshot.parquet");
      const repository = createRepository();
      const parquetBytes = "parquet bytes";
      const expectedSha256 = createHash("sha256")
        .update(parquetBytes)
        .digest("hex");

      await writeFile(parquetPath, parquetBytes, "utf8");
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            snapshotMonth: "2026-04",
            snapshotId: "snapshot-2026-04",
            source: {
              parquetPath,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const sourceKeySpy = vi.spyOn(
        manifestModule,
        "buildSourceKeyFromVerifiedSource",
      );

      await expect(
        importSnapshotToClickHouse({
          manifestPath,
          repository: repository as BulkImportRepository,
          createImportVersion: () => "import-2026-04",
        }),
      ).resolves.toMatchObject({
        importVersion: "import-2026-04",
        snapshotMonth: "2026-04",
        rowCount: 0,
      });

      expect(sourceKeySpy).toHaveBeenCalledTimes(1);
      expect(sourceKeySpy).toHaveBeenCalledWith(
        {
          parquetPath,
          sizeBytes: Buffer.byteLength(parquetBytes),
          checksum: {
            algorithm: "sha256",
            value: expectedSha256,
          },
        },
        "2026-04",
      );
    });
  });
});

describe("ClickHouseBulkImportRepository", () => {
  it("streams parquet into the raw table and counts rows by import version", async () => {
    await withTempDir(async (tempDir) => {
      const client = new MockClickHouseClient();
      client.queryResponses.push([{ row_count: "7" }]);
      const repository = new ClickHouseBulkImportRepository({
        client,
      });
      const parquetPath = path.join(tempDir, "snapshot.parquet");

      await writeFile(parquetPath, "parquet fixture bytes", "utf8");

      const result = await repository.importRawRowsFromParquet({
        importVersion: "import-2026-04",
        snapshotMonth: "2026-04",
        parquetPath,
      });

      expect(result).toEqual({
        rowCount: 7,
      });
      expect(client.execCalls).toHaveLength(1);
      expect(client.execCalls[0]).toEqual(
        expect.objectContaining({
          query: expect.stringContaining("INSERT INTO bulk_hostname_raw"),
          query_params: {
            import_version: "import-2026-04",
            snapshot_month: "2026-04",
          },
        }),
      );
      expect(String(client.execCalls[0].query)).toContain("FORMAT Parquet");
      expect(String(client.execCalls[0].query)).toContain("FROM input(");
      expect(client.queryCalls).toHaveLength(1);
      expect(client.queryCalls[0]).toEqual(
        expect.objectContaining({
          query: expect.stringContaining("FROM bulk_hostname_raw"),
          query_params: {
            import_version: "import-2026-04",
          },
          format: "JSONEachRow",
        }),
      );
    });
  });

  it("writes importing, ready, and failed events to bulk_import_attempt_events with expected payloads", async () => {
    const client = new MockClickHouseClient();
    const repository = new ClickHouseBulkImportRepository({
      client,
    });

    await repository.registerImportStart({
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc:123",
      snapshotMonth: "2026-04",
      sourceParquetPath: "C:\\bulk\\2026-04\\snapshot.parquet",
      sourceFileBytes: 123,
      sourceFileSha256: "a".repeat(64),
      recordedAt: "2026-05-15T10:00:00.000Z",
    });
    await repository.markImportReady({
      importVersion: "import-2026-04",
      sourceKey: "2026-04:abc:123",
      snapshotMonth: "2026-04",
      sourceParquetPath: "C:\\bulk\\2026-04\\snapshot.parquet",
      sourceFileBytes: 123,
      sourceFileSha256: "a".repeat(64),
      rowCount: 7,
      recordedAt: "2026-05-15T10:01:00.000Z",
    });
    await repository.markImportFailed({
      importVersion: "import-2026-05",
      sourceKey: "2026-05:def:456",
      snapshotMonth: "2026-05",
      sourceParquetPath: "C:\\bulk\\2026-05\\snapshot.parquet",
      sourceFileBytes: 456,
      sourceFileSha256: "b".repeat(64),
      errorMessage: "stream failed",
      recordedAt: "2026-05-15T10:02:00.000Z",
    });

    expect(client.commandCalls).toHaveLength(3);
    expect(client.commandCalls.every((call) =>
      typeof call.query === "string" &&
      call.query.includes("INSERT INTO bulk_import_attempt_events")
    )).toBe(true);
    expect(client.commandCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          query_params: expect.objectContaining({
            import_version: "import-2026-04",
            source_key: "2026-04:abc:123",
            snapshot_month: "2026-04",
            source_parquet_path: "C:\\bulk\\2026-04\\snapshot.parquet",
            source_file_bytes: 123,
            source_file_sha256: "a".repeat(64),
            status: "importing",
            row_count: 0,
            error_message: null,
            recorded_at: "2026-05-15 10:00:00.000",
          }),
        }),
        expect.objectContaining({
          query_params: expect.objectContaining({
            import_version: "import-2026-04",
            source_key: "2026-04:abc:123",
            snapshot_month: "2026-04",
            source_parquet_path: "C:\\bulk\\2026-04\\snapshot.parquet",
            source_file_bytes: 123,
            source_file_sha256: "a".repeat(64),
            status: "ready",
            row_count: 7,
            error_message: null,
            recorded_at: "2026-05-15 10:01:00.000",
          }),
        }),
        expect.objectContaining({
          query_params: expect.objectContaining({
            import_version: "import-2026-05",
            source_key: "2026-05:def:456",
            snapshot_month: "2026-05",
            source_parquet_path: "C:\\bulk\\2026-05\\snapshot.parquet",
            source_file_bytes: 456,
            source_file_sha256: "b".repeat(64),
            status: "failed",
            row_count: 0,
            error_message: "stream failed",
            recorded_at: "2026-05-15 10:02:00.000",
          }),
        }),
      ]),
    );
  });
});
