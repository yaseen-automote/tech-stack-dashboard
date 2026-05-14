import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildApplyPrompt,
  dismissFixes,
  getAuditContextFile,
  getVisibleIssues,
  restoreFixes,
  saveHiddenFixes,
} from "@/tools/impeccable-audit-report/report-data.js";

describe("impeccable audit report data", () => {
  it("persists dismissed fixes and filters them from future reports", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "audit-report-state-"));

    const before = getVisibleIssues(projectRoot);
    expect(before.issues.length).toBeGreaterThanOrEqual(50);

    dismissFixes(projectRoot, ["a11y-skip-link", "theme-sidebar-fill-hardcode"]);

    const stateFile = getAuditContextFile(projectRoot);
    expect(fs.existsSync(stateFile)).toBe(true);

    const afterDismiss = getVisibleIssues(projectRoot);
    expect(afterDismiss.hiddenState.dismissedIds).toEqual([
      "a11y-skip-link",
      "theme-sidebar-fill-hardcode",
    ]);
    expect(afterDismiss.issues.some((entry) => entry.id === "a11y-skip-link")).toBe(false);
    expect(afterDismiss.issues.some((entry) => entry.id === "theme-sidebar-fill-hardcode")).toBe(false);

    restoreFixes(projectRoot, ["a11y-skip-link"]);

    const afterRestore = getVisibleIssues(projectRoot);
    expect(afterRestore.hiddenState.dismissedIds).toEqual(["theme-sidebar-fill-hardcode"]);
    expect(afterRestore.issues.some((entry) => entry.id === "a11y-skip-link")).toBe(true);
  });

  it("drops unknown ids when saving hidden fixes", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "audit-report-save-"));
    const payload = saveHiddenFixes(projectRoot, ["fake-id", "anti-card-grid-fatigue"]);

    expect(payload.dismissedIds).toEqual(["anti-card-grid-fatigue"]);
  });

  it("builds an implementation prompt from selected fixes", () => {
    const prompt = buildApplyPrompt([
      "a11y-skip-link",
      "resp-results-table-overflow",
      "anti-generic-status-copy",
    ]);

    expect(prompt).toContain("Apply the following selected fixes");
    expect(prompt).toContain("[P1] Add a skip link ahead of the fixed shell");
    expect(prompt).toContain("[P1] Replace mandatory horizontal scrolling with a mobile table strategy");
    expect(prompt).toContain("[P2] Replace vague shell copy like `Graph online`");
    expect(prompt).toContain("After implementing, keep any unselected or dismissed findings untouched.");
  });
});
