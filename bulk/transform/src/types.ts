export type ReadyTransformRecord = {
  loadVersion: string;
  sourceKey: string;
  snapshotMonth: string;
  rowCount: number;
};

export type ReadyTransformContextRecord = ReadyTransformRecord & {
  importVersion: string;
};

export interface BulkTransformRepository {
  ensureSchema(): Promise<void>;
  findReadyTransformBySourceKey(sourceKey: string): Promise<ReadyTransformContextRecord | null>;
  registerTransformStart(params: {
    loadVersion: string;
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
  }): Promise<void>;
  transformImportIntoServing(params: {
    loadVersion: string;
    importVersion: string;
    snapshotMonth: string;
  }): Promise<number>;
  markTransformReady(
    params: ReadyTransformContextRecord,
  ): Promise<void>;
  markTransformFailed(params: {
    loadVersion: string;
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    errorMessage: string;
  }): Promise<void>;
  activateLoad(params: {
    loadVersion: string;
    snapshotMonth: string;
  }): Promise<void>;
}

export type TransformImportedSnapshotResult = ReadyTransformRecord;
