import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterAll } from "vitest";

const projectRoot = join(import.meta.dirname ?? ".", "..", "..");
const reportScript = join(projectRoot, "bulk", "polars", "src", "report.py");

const pythonBin = process.platform === "win32" ? "python" : "python3";

let tmpDir: string;

function createTempDir() {
  if (!tmpDir) {
    tmpDir = mkdtempSync(join(tmpdir(), "polars-report-test-"));
  }
  return tmpDir;
}

afterAll(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("polars cleanup report", () => {
  it("builds a cleanup report from exported raw rows", () => {
    const workDir = createTempDir();
    const inputCsvPath = join(workDir, "input.csv");
    const outputJsonPath = join(workDir, "report.json");

    writeFileSync(
      inputCsvPath,
      [
        "hostname,ip_address",
        "api.example.com,203.0.113.10",
        "www.example.com,203.0.113.20",
        "api.example.com,203.0.113.30",
      ].join("\n"),
    );

    execSync(
      `${pythonBin} "${reportScript}" --input "${inputCsvPath}" --output "${outputJsonPath}"`,
      { cwd: projectRoot, stdio: "pipe", encoding: "utf-8" },
    );

    expect(existsSync(outputJsonPath)).toBe(true);

    const report = JSON.parse(readFileSync(outputJsonPath, "utf-8"));
    expect(report.totalRows).toBe(3);
    expect(report.duplicateHostnames).toBe(2);
    expect(report.emptyIpRows).toBe(0);
  });

  it("counts null ip_address rows as empty ip rows", () => {
    const workDir = createTempDir();
    const inputCsvPath = join(workDir, "input.csv");
    const outputJsonPath = join(workDir, "report.json");

    writeFileSync(
      inputCsvPath,
      [
        "hostname,ip_address",
        "api.example.com,",
        "www.example.net,10.0.0.1",
      ].join("\n"),
    );

    execSync(
      `${pythonBin} "${reportScript}" --input "${inputCsvPath}" --output "${outputJsonPath}"`,
      { cwd: projectRoot, stdio: "pipe" },
    );

    const report = JSON.parse(readFileSync(outputJsonPath, "utf-8"));
    expect(report.totalRows).toBe(2);
    expect(report.emptyIpRows).toBe(1);
  });
}, 30000);