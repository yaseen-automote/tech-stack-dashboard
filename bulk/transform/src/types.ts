export type ReadyTransformRecord = {
  loadVersion: string;
  sourceKey: string;
  snapshotMonth: string;
  rowCount: number;
};

export interface BulkTransformRepository {
  ensureSchema(): Promise<void>;
  findReadyTransformBySourceKey(sourceKey: string): Promise<ReadyTransformRecord | null>;
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
    params: ReadyTransformRecord & {
      importVersion: string;
    },
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
