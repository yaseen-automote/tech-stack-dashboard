// @vitest-environment node

import { gzipSync } from "node:zlib";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { importCtDumpToClickHouse } from "./src/importer";
import { ClickHouseCtImportRepository } from "./src/repository";

describe("ct import", () => {
  it("fails before ClickHouse writes when the CT manifest is missing", async () => {
    const repository = {
      ensureSchema: vi.fn(),
      registerImportStart: vi.fn(),
      importRawCtLines: vi.fn(),
      markImportReady: vi.fn(),
      markImportFailed: vi.fn(),
    };

    await expect(
      importCtDumpToClickHouse({
        manifestPath: "C:/missing/ct-manifest.json",
        repository,
      }),
    ).rejects.toThrow(/ct-manifest\.json/);

    expect(repository.registerImportStart).not.toHaveBeenCalled();
  });

  it("streams gzip lines into raw ClickHouse rows and marks the import ready", async () => {
    const root = await mkdtemp(join(tmpdir(), "ct-import-"));
    const dumpDir = join(root, "ct", "input", "2025-11-24");
    await mkdir(dumpDir, { recursive: true });
    const gzipPath = join(dumpDir, "2025-11-24.txt.gz");
    const gzipBytes = gzipSync(Buffer.from("line-1\nline-2\nline-3\n"));
    await writeFile(gzipPath, gzipBytes);
    const checksum = createHash("sha256").update(gzipBytes).digest("hex");
    const manifestPath = join(dumpDir, "ct-manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          dumpDate: "2025-11-24",
          source: {
            sourceUrl: "https://cs2.ip.thc.org/2025-11-24.txt.gz",
            gzipPath,
            sizeBytes: gzipBytes.byteLength,
            checksum: {
              algorithm: "sha256",
              value: checksum,
            },
          },
        },
        null,
        2,
      ),
    );

    const repository = {
      ensureSchema: vi.fn(),
      registerImportStart: vi.fn(),
      importRawCtLines: vi.fn().mockResolvedValue({ rowCount: 3 }),
      markImportReady: vi.fn(),
      markImportFailed: vi.fn(),
    };

    const result = await importCtDumpToClickHouse({
      manifestPath,
      repository,
      createImportVersion: () => "ct-import-2025-11-24",
    });

    expect(repository.importRawCtLines).toHaveBeenCalledWith(
      expect.objectContaining({
        importVersion: "ct-import-2025-11-24",
        dumpDate: "2025-11-24",
      }),
    );
    expect(result.rowCount).toBe(3);
    expect(repository.markImportReady).toHaveBeenCalled();
  });

  it("batches raw CT line inserts instead of buffering the full dump", async () => {
    const root = await mkdtemp(join(tmpdir(), "ct-import-batch-"));
    const gzipPath = join(root, "2025-11-24.txt.gz");
    const gzipBytes = gzipSync(Buffer.from("line-1\nline-2\nline-3\n"));
    await writeFile(gzipPath, gzipBytes);

    const insert = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({
      json: async () => [{ row_count: 3 }],
    });

    const repository = new ClickHouseCtImportRepository({
      client: {
        command: vi.fn(),
        insert,
        query,
      },
      batchSize: 1,
    });

    const result = await repository.importRawCtLines({
      importVersion: "ct-import-2025-11-24",
      dumpDate: "2025-11-24",
      sourceUrl: "https://cs2.ip.thc.org/2025-11-24.txt.gz",
      sourceSha256: createHash("sha256").update(gzipBytes).digest("hex"),
      gzipPath,
    });

    expect(result).toEqual({ rowCount: 3 });
    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        table: "ct_log_line_raw",
        values: [
          expect.objectContaining({
            source_line_number: 1,
            raw_line: "line-1",
          }),
        ],
      }),
    );
  });

  it("normalizes ISO recordedAt values before writing import attempt events", async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const repository = new ClickHouseCtImportRepository({
      client: {
        command,
        insert: vi.fn(),
        query: vi.fn(),
      },
    });

    await repository.registerImportStart({
      importVersion: "ct-import-2025-11-24",
      dumpDate: "2025-11-24",
      sourceUrl: "https://cs2.ip.thc.org/2025-11-24.txt.gz",
      sourceGzipPath: "/tmp/2025-11-24.txt.gz",
      sourceFileBytes: 123,
      sourceFileSha256: "a".repeat(64),
      recordedAt: "2026-05-18T10:32:09.379Z",
    });

    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        query_params: expect.objectContaining({
          recorded_at: "2026-05-18 10:32:09.379",
        }),
      }),
    );
  });
});
