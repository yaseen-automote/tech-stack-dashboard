import type { BulkImportRepository, ImportSnapshotResult } from "./types";
import {
  buildSourceKeyFromVerifiedSource,
  readManifest,
  verifyManifestSource,
} from "./manifest";

function formatClickHouseDateTime64(date: Date) {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");

  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`,
  ].join(" ");
}

export async function importSnapshotToClickHouse(options: {
  manifestPath: string;
  repository: BulkImportRepository;
  createImportVersion?: () => string;
  now?: () => Date;
}): Promise<ImportSnapshotResult> {
  const manifest = await readManifest(options.manifestPath);
  const source = await verifyManifestSource(manifest);
  const createImportVersion = options.createImportVersion ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  const recordedAt = () => formatClickHouseDateTime64(now());
  const sourceKey = buildSourceKeyFromVerifiedSource(
    source,
    manifest.snapshotMonth,
  );
  const importVersion = createImportVersion();

  await options.repository.ensureSchema();

  await options.repository.registerImportStart({
    importVersion,
    snapshotMonth: manifest.snapshotMonth,
    sourceKey,
    sourceParquetPath: source.parquetPath,
    sourceFileBytes: source.sizeBytes,
    sourceFileSha256: source.checksum.value,
    recordedAt: recordedAt(),
  });

  try {
    const result = await options.repository.importRawRowsFromParquet({
      importVersion,
      snapshotMonth: manifest.snapshotMonth,
      parquetPath: source.parquetPath,
    });

    await options.repository.markImportReady({
      importVersion,
      sourceKey,
      snapshotMonth: manifest.snapshotMonth,
      sourceParquetPath: source.parquetPath,
      sourceFileBytes: source.sizeBytes,
      sourceFileSha256: source.checksum.value,
      rowCount: result.rowCount,
      recordedAt: recordedAt(),
    });

    return {
      importVersion,
      sourceKey,
      snapshotMonth: manifest.snapshotMonth,
      rowCount: result.rowCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await options.repository.markImportFailed({
      importVersion,
      sourceKey,
      snapshotMonth: manifest.snapshotMonth,
      sourceParquetPath: source.parquetPath,
      sourceFileBytes: source.sizeBytes,
      sourceFileSha256: source.checksum.value,
      errorMessage,
      recordedAt: recordedAt(),
    });

    throw error;
  }
}
