type BulkTransformCliArgs = {
  snapshotMonth: string;
  importVersion: string;
  sourceKey: string;
};

type BulkTransformConfig = {
  snapshotMonth: string;
  importVersion: string;
  sourceKey: string;
  clickhouse: {
    url: string;
    database: string;
    username: string;
    password: string;
  };
};

type BulkTransformEnv = Record<string, string | undefined>;

function requireEnv(env: BulkTransformEnv, name: string) {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing required bulk transform environment variable: ${name}`);
  }

  return value;
}

function readRequiredFlag(argv: string[], flagName: string) {
  const flagIndex = argv.indexOf(flagName);

  if (flagIndex === -1 || flagIndex === argv.length - 1) {
    throw new Error(
      `Missing required ${flagName} argument. Example: npm run bulk:transform -- --snapshot-month 2026-04 --import-version import-2026-04 --source-key 2026-04:abc`,
    );
  }

  return argv[flagIndex + 1];
}

export function parseTransformCliArgs(argv: string[]): BulkTransformCliArgs {
  return {
    snapshotMonth: readRequiredFlag(argv, "--snapshot-month"),
    importVersion: readRequiredFlag(argv, "--import-version"),
    sourceKey: readRequiredFlag(argv, "--source-key"),
  };
}

export function readBulkTransformConfig(
  env: BulkTransformEnv,
  cliArgs: BulkTransformCliArgs,
): BulkTransformConfig {
  const host = requireEnv(env, "CLICKHOUSE_HOST");
  const port = requireEnv(env, "CLICKHOUSE_PORT");

  if (Number.isNaN(Number(port))) {
    throw new Error("CLICKHOUSE_PORT must be a valid number.");
  }

  return {
    snapshotMonth: cliArgs.snapshotMonth,
    importVersion: cliArgs.importVersion,
    sourceKey: cliArgs.sourceKey,
    clickhouse: {
      url: `http://${host}:${port}`,
      database: requireEnv(env, "CLICKHOUSE_DATABASE"),
      username: requireEnv(env, "CLICKHOUSE_USER"),
      password: requireEnv(env, "CLICKHOUSE_PASSWORD"),
    },
  };
}

export type { BulkTransformCliArgs, BulkTransformConfig };
