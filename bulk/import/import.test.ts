// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { importSnapshotToClickHouse } from "./src/importer";
import * as manifestModule from "./src/manifest";
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
