// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchCtDumpForDate, parseCtDumpIndex } from "./src/fetcher";

describe("ct fetch", () => {
  it("extracts dated gzip dumps from the CT source index", () => {
    const html = `
      <a href="2025-11-24.txt.gz">2025-11-24.txt.gz</a>
      <a href="2025-11-25.txt.gz">2025-11-25.txt.gz</a>
    `;

    expect(parseCtDumpIndex(html)).toEqual([
      { dumpDate: "2025-11-24", fileName: "2025-11-24.txt.gz" },
      { dumpDate: "2025-11-25", fileName: "2025-11-25.txt.gz" },
    ]);
  });

  it("writes a manifest after download and checksum calculation", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "ct-fetch-"));
    const result = await fetchCtDumpForDate({
      targetDate: "2025-11-24",
      storageRoot,
      fetchText: vi.fn().mockResolvedValue('<a href="2025-11-24.txt.gz">2025-11-24.txt.gz</a>'),
      fetchBytes: vi.fn().mockResolvedValue(Buffer.from("gzip-bytes")),
    });

    expect(result.manifest.dumpDate).toBe("2025-11-24");
    expect(result.manifest.source.gzipPath).toContain("2025-11-24.txt.gz");
    expect(result.manifest.source.sizeBytes).toBeGreaterThan(0);
    expect(result.manifest.source.checksum.algorithm).toBe("sha256");

    const manifestText = await readFile(result.manifestPath, "utf8");
    expect(JSON.parse(manifestText)).toEqual(result.manifest);
  });
});
