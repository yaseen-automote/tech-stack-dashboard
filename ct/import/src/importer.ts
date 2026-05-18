import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";

import type { CtFetchManifest } from "@/ct/types";
import { ClickHouseCtImportRepository } from "./repository";

async function readManifest(manifestPath: string): Promise<CtFetchManifest> {
  const rawText = await readFile(manifestPath, "utf8");
  return JSON.parse(rawText) as CtFetchManifest;
}

async function verifyManifestSource(manifest: CtFetchManifest) {
  await access(manifest.source.gzipPath);
  const gzipStats = await stat(manifest.source.gzipPath);
  if (gzipStats.size !== manifest.source.sizeBytes) {
    throw new Error("The CT source gzip size did not match the manifest.");
  }

  const checksum = await hashFileSha256(manifest.source.gzipPath);
  if (checksum !== manifest.source.checksum.value) {
    throw new Error("The CT source gzip checksum did not match the manifest.");
  }
}

async function hashFileSha256(filePath: string) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function importCtDumpToClickHouse(options: {
  manifestPath: string;
  repository: Pick<
    ClickHouseCtImportRepository,
    | "ensureSchema"
    | "registerImportStart"
    | "importRawCtLines"
    | "markImportReady"
    | "markImportFailed"
  >;
  createImportVersion?: () => string;
}) {
  const manifest = await readManifest(options.manifestPath);
  await verifyManifestSource(manifest);

  const importVersion = options.createImportVersion?.() ?? crypto.randomUUID();
  const recordedAt = new Date().toISOString();

  try {
    await options.repository.ensureSchema();
    await options.repository.registerImportStart({
      importVersion,
      dumpDate: manifest.dumpDate,
      sourceUrl: manifest.source.sourceUrl,
      sourceGzipPath: manifest.source.gzipPath,
      sourceFileBytes: manifest.source.sizeBytes,
      sourceFileSha256: manifest.source.checksum.value,
      recordedAt,
    });

    const importResult = await options.repository.importRawCtLines({
      importVersion,
      dumpDate: manifest.dumpDate,
      sourceUrl: manifest.source.sourceUrl,
      sourceSha256: manifest.source.checksum.value,
      gzipPath: manifest.source.gzipPath,
    });

    await options.repository.markImportReady({
      importVersion,
      dumpDate: manifest.dumpDate,
      sourceUrl: manifest.source.sourceUrl,
      sourceGzipPath: manifest.source.gzipPath,
      sourceFileBytes: manifest.source.sizeBytes,
      sourceFileSha256: manifest.source.checksum.value,
      rowCount: importResult.rowCount,
      recordedAt: new Date().toISOString(),
    });

    return {
      importVersion,
      dumpDate: manifest.dumpDate,
      rowCount: importResult.rowCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await options.repository.markImportFailed({
      importVersion,
      dumpDate: manifest.dumpDate,
      sourceUrl: manifest.source.sourceUrl,
      sourceGzipPath: manifest.source.gzipPath,
      sourceFileBytes: manifest.source.sizeBytes,
      sourceFileSha256: manifest.source.checksum.value,
      errorMessage: message,
      recordedAt: new Date().toISOString(),
    });
    throw error;
  }
}
