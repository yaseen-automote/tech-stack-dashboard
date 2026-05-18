import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CtDumpIndexEntry, CtFetchManifest } from "@/ct/types";

export const CT_SOURCE_INDEX_URL = "https://cs2.ip.thc.org/";

const CT_DUMP_PATTERN = /href="(\d{4}-\d{2}-\d{2}\.txt\.gz)"/g;

async function defaultFetchText(url: string) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`The CT source index request failed with status ${response.status}.`);
  }

  return response.text();
}

async function defaultFetchBytes(url: string) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`The CT dump download failed with status ${response.status}.`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export function parseCtDumpIndex(html: string): CtDumpIndexEntry[] {
  return [...html.matchAll(CT_DUMP_PATTERN)].map((match) => {
    const fileName = match[1] ?? "";
    return {
      fileName,
      dumpDate: fileName.replace(/\.txt\.gz$/, ""),
    };
  });
}

export async function fetchCtDumpForDate(options: {
  targetDate: string;
  storageRoot: string;
  fetchText?: (url: string) => Promise<string>;
  fetchBytes?: (url: string) => Promise<Buffer>;
}) {
  const indexHtml = await (options.fetchText ?? defaultFetchText)(CT_SOURCE_INDEX_URL);
  const dumps = parseCtDumpIndex(indexHtml);
  const match = dumps.find((entry) => entry.dumpDate === options.targetDate);

  if (!match) {
    throw new Error(`No CT dump was listed for ${options.targetDate}.`);
  }

  const sourceUrl = new URL(match.fileName, CT_SOURCE_INDEX_URL).toString();
  const gzipBytes = await (options.fetchBytes ?? defaultFetchBytes)(sourceUrl);
  const dumpDir = join(options.storageRoot, "ct", "input", options.targetDate);
  const gzipPath = join(dumpDir, match.fileName);
  await mkdir(dumpDir, { recursive: true });
  await writeFile(gzipPath, gzipBytes);

  const checksum = createHash("sha256").update(gzipBytes).digest("hex");
  const manifest: CtFetchManifest = {
    dumpDate: options.targetDate,
    source: {
      sourceUrl,
      gzipPath,
      sizeBytes: gzipBytes.byteLength,
      checksum: {
        algorithm: "sha256",
        value: checksum,
      },
    },
  };

  const manifestPath = join(dumpDir, "ct-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    manifestPath,
    manifest,
  };
}
