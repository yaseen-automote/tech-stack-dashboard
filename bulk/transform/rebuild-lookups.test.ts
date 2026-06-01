// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { rebuildDiscoveryLookups } from "./src/rebuild-lookups";

describe("rebuildDiscoveryLookups", () => {
  it("truncates both split lookup tables before rebuilding from the active load", async () => {
    const repository = {
      ensureSchema: vi.fn(),
      findActiveLoadVersion: vi.fn().mockResolvedValue({
        loadVersion: "load-2026-04",
        snapshotMonth: "2026-04",
      }),
      truncateSplitLookupTables: vi.fn(),
      rebuildSplitLookupTablesForLoad: vi.fn().mockResolvedValue({
        apexCount: 432120184,
        subdomainCount: 5647047870,
      }),
    };

    await rebuildDiscoveryLookups({ repository });

    expect(repository.truncateSplitLookupTables).toHaveBeenCalledTimes(1);
    expect(repository.rebuildSplitLookupTablesForLoad).toHaveBeenCalledWith({
      loadVersion: "load-2026-04",
      snapshotMonth: "2026-04",
    });
  });

  it("throws when no active hostname serving load exists", async () => {
    const repository = {
      ensureSchema: vi.fn(),
      findActiveLoadVersion: vi.fn().mockResolvedValue(null),
      truncateSplitLookupTables: vi.fn(),
      rebuildSplitLookupTablesForLoad: vi.fn(),
    };

    await expect(rebuildDiscoveryLookups({ repository })).rejects.toThrow(
      "No active hostname serving load is available for lookup-table rebuild.",
    );

    expect(repository.truncateSplitLookupTables).not.toHaveBeenCalled();
    expect(repository.rebuildSplitLookupTablesForLoad).not.toHaveBeenCalled();
  });
});
