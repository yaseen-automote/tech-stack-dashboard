type BulkImportCliArgs = {
  manifestPath: string;
};

type BulkImportConfig = {
  manifestPath: string;
  clickhouse: {
    url: string;
    database: string;
    username: string;
    password: string;
  };
};

type BulkImportEnv = Record<string, string | undefined>;

function requireEnv(env: BulkImportEnv, name: string) {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing required bulk import environment variable: ${name}`);
  }

  return value;
}

function readRequiredFlag(argv: string[], flagName: string) {
  const flagIndex = argv.indexOf(flagName);

  if (flagIndex === -1 || flagIndex === argv.length - 1) {
    throw new Error(
      `Missing required ${flagName} argument. Example: npm run bulk:import -- --manifest ./path/to/monthly-manifest.json`,
    );
  }

  return argv[flagIndex + 1];
}

export function parseImportCliArgs(argv: string[]): BulkImportCliArgs {
  const manifestPath = readRequiredFlag(argv, "--manifest");

  return {
    manifestPath,
  };
}

export function readBulkImportConfig(
  env: BulkImportEnv,
  cliArgs: BulkImportCliArgs,
): BulkImportConfig {
  const host = requireEnv(env, "CLICKHOUSE_HOST");
  const port = requireEnv(env, "CLICKHOUSE_PORT");

  if (Number.isNaN(Number(port))) {
    throw new Error("CLICKHOUSE_PORT must be a valid number.");
  }

  return {
    manifestPath: cliArgs.manifestPath,
    clickhouse: {
      url: `http://${host}:${port}`,
      database: requireEnv(env, "CLICKHOUSE_DATABASE"),
      username: requireEnv(env, "CLICKHOUSE_USER"),
      password: requireEnv(env, "CLICKHOUSE_PASSWORD"),
    },
  };
}

export type { BulkImportCliArgs, BulkImportConfig };
