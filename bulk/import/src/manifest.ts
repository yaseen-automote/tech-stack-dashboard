import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { BulkImportManifest, VerifiedImportSource } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeManifestPath(basePath: string, candidatePath: string) {
  if (path.isAbsolute(candidatePath)) {
    return path.normalize(candidatePath);
  }

  return path.resolve(basePath, candidatePath);
}

async function hashFileSha256(filePath: string) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function readManifest(
  manifestPath: string,
): Promise<BulkImportManifest> {
  const manifestContent = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(manifestContent) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("Bulk import manifest must be a JSON object.");
  }

  if (
    typeof parsed.snapshotMonth !== "string" ||
    !/^\d{4}-\d{2}$/.test(parsed.snapshotMonth)
  ) {
    throw new Error(
      "Bulk import manifest must include snapshotMonth in YYYY-MM format.",
    );
  }

  if (typeof parsed.snapshotId !== "string" || parsed.snapshotId.length === 0) {
    throw new Error("Bulk import manifest must include snapshotId.");
  }

  if (!isRecord(parsed.source) || typeof parsed.source.parquetPath !== "string") {
    throw new Error("Bulk import manifest must include source.parquetPath.");
  }

  if (
    parsed.source.sizeBytes !== undefined &&
    (typeof parsed.source.sizeBytes !== "number" || parsed.source.sizeBytes < 0)
  ) {
    throw new Error("source.sizeBytes must be a non-negative number when provided.");
  }

  if (parsed.source.checksum !== undefined) {
    if (
      !isRecord(parsed.source.checksum) ||
      parsed.source.checksum.algorithm !== "sha256" ||
      typeof parsed.source.checksum.value !== "string"
    ) {
      throw new Error(
        "source.checksum must be an object with algorithm 'sha256' and a value.",
      );
    }
  }

  const parsedChecksum =
    parsed.source.checksum && isRecord(parsed.source.checksum)
      ? parsed.source.checksum
      : undefined;

  return {
    snapshotMonth: parsed.snapshotMonth,
    snapshotId: parsed.snapshotId,
    source: {
      parquetPath: normalizeManifestPath(
        path.dirname(manifestPath),
        parsed.source.parquetPath,
      ),
      sizeBytes:
        typeof parsed.source.sizeBytes === "number"
          ? parsed.source.sizeBytes
          : undefined,
      checksum: parsedChecksum
        ? {
            algorithm: "sha256",
            value: parsedChecksum.value as string,
          }
        : undefined,
    },
  };
}

export async function verifyManifestSource(
  manifest: BulkImportManifest,
): Promise<VerifiedImportSource> {
  const sourceFile = await stat(manifest.source.parquetPath).catch(() => null);

  if (!sourceFile?.isFile()) {
    throw new Error(
      `Snapshot parquet file is missing: ${manifest.source.parquetPath}`,
    );
  }

  if (
    manifest.source.sizeBytes !== undefined &&
    sourceFile.size !== manifest.source.sizeBytes
  ) {
    throw new Error(
      `Snapshot size mismatch for ${manifest.source.parquetPath}: expected ${manifest.source.sizeBytes}, got ${sourceFile.size}.`,
    );
  }

  const sha256 = await hashFileSha256(manifest.source.parquetPath);

  if (manifest.source.checksum && sha256 !== manifest.source.checksum.value) {
    throw new Error(
      `Snapshot checksum mismatch for ${manifest.source.parquetPath}.`,
    );
  }

  return {
    parquetPath: manifest.source.parquetPath,
    sizeBytes: sourceFile.size,
    checksum: {
      algorithm: "sha256",
      value: sha256,
    },
  };
}

export function buildSourceKeyFromVerifiedSource(
  source: VerifiedImportSource,
  snapshotMonth: string,
) {
  return `${snapshotMonth}:${source.checksum.value}:${source.sizeBytes}`;
}
