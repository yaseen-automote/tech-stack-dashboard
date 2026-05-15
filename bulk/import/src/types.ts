export type BulkImportManifest = {
  snapshotMonth: string;
  snapshotId: string;
  source: {
    parquetPath: string;
    sizeBytes?: number;
    checksum?: {
      algorithm: "sha256";
      value: string;
    };
  };
};

export type VerifiedImportSource = {
  parquetPath: string;
  sizeBytes: number;
  checksum: {
    algorithm: "sha256";
    value: string;
  };
};

export interface BulkImportRepository {
  ensureSchema(): Promise<void>;
  registerImportStart(params: {
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    sourceParquetPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    recordedAt: string;
  }): Promise<void>;
  importRawRowsFromParquet(params: {
    importVersion: string;
    snapshotMonth: string;
    parquetPath: string;
  }): Promise<{ rowCount: number }>;
  markImportReady(params: {
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    sourceParquetPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    rowCount: number;
    recordedAt: string;
  }): Promise<void>;
  markImportFailed(params: {
    importVersion: string;
    sourceKey: string;
    snapshotMonth: string;
    sourceParquetPath: string;
    sourceFileBytes: number;
    sourceFileSha256: string;
    errorMessage: string;
    recordedAt: string;
  }): Promise<void>;
}

export type ImportSnapshotResult = {
  importVersion: string;
  sourceKey: string;
  snapshotMonth: string;
  rowCount: number;
};
