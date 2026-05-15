import type {
  BulkTransformRepository,
  TransformImportedSnapshotResult,
} from "./types";

export async function transformImportedSnapshot(options: {
  snapshotMonth: string;
  importVersion: string;
  sourceKey: string;
  repository: BulkTransformRepository;
  createLoadVersion?: () => string;
}): Promise<TransformImportedSnapshotResult> {
  await options.repository.ensureSchema();

  const readyTransform = await options.repository.findReadyTransformBySourceKey(
    options.sourceKey,
  );

  if (readyTransform) {
    await options.repository.activateLoad({
      loadVersion: readyTransform.loadVersion,
      snapshotMonth: readyTransform.snapshotMonth,
    });

    return readyTransform;
  }

  const loadVersion = options.createLoadVersion?.() ?? crypto.randomUUID();

  await options.repository.registerTransformStart({
    loadVersion,
    importVersion: options.importVersion,
    sourceKey: options.sourceKey,
    snapshotMonth: options.snapshotMonth,
  });

  try {
    const rowCount = await options.repository.transformImportIntoServing({
      loadVersion,
      importVersion: options.importVersion,
      snapshotMonth: options.snapshotMonth,
    });

    const readyTransform = {
      loadVersion,
      importVersion: options.importVersion,
      sourceKey: options.sourceKey,
      snapshotMonth: options.snapshotMonth,
      rowCount,
    };

    await options.repository.markTransformReady(readyTransform);
    await options.repository.activateLoad({
      loadVersion,
      snapshotMonth: options.snapshotMonth,
    });

    return {
      loadVersion,
      sourceKey: options.sourceKey,
      snapshotMonth: options.snapshotMonth,
      rowCount,
    };
  } catch (error) {
    await options.repository.markTransformFailed({
      loadVersion,
      importVersion: options.importVersion,
      sourceKey: options.sourceKey,
      snapshotMonth: options.snapshotMonth,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
