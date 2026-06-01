export async function rebuildDiscoveryLookups(options: {
  repository: {
    ensureSchema(): Promise<void>;
    findActiveLoadVersion(): Promise<{ loadVersion: string; snapshotMonth: string } | null>;
    truncateSplitLookupTables(): Promise<void>;
    rebuildSplitLookupTablesForLoad(params: {
      loadVersion: string;
      snapshotMonth: string;
    }): Promise<{ apexCount: number; subdomainCount: number }>;
  };
}) {
  await options.repository.ensureSchema();
  const activeLoad = await options.repository.findActiveLoadVersion();
  if (!activeLoad) {
    throw new Error("No active hostname serving load is available for lookup-table rebuild.");
  }

  await options.repository.truncateSplitLookupTables();
  return options.repository.rebuildSplitLookupTablesForLoad(activeLoad);
}
