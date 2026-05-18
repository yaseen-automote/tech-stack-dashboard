export type CtTransformCliArgs = {
  dumpDate: string;
  importVersion: string;
};

export type CtTransformConfig = {
  dumpDate: string;
  importVersion: string;
  clickhouse: {
    url: string;
    database: string;
    username: string;
    password: string;
  };
};

function readRequiredFlag(argv: string[], name: "--dump-date" | "--import-version") {
  const index = argv.findIndex((value) => value === name);
  if (index === -1 || !argv[index + 1]) {
    throw new Error(`Missing required flag: ${name}`);
  }
  return argv[index + 1] as string;
}

function requireEnv(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required CT transform environment variable: ${name}`);
  }
  return value;
}

export function parseCtTransformCliArgs(argv: string[]): CtTransformCliArgs {
  return {
    dumpDate: readRequiredFlag(argv, "--dump-date"),
    importVersion: readRequiredFlag(argv, "--import-version"),
  };
}

export function readCtTransformConfig(
  env: NodeJS.ProcessEnv,
  cliArgs: CtTransformCliArgs,
): CtTransformConfig {
  return {
    dumpDate: cliArgs.dumpDate,
    importVersion: cliArgs.importVersion,
    clickhouse: {
      url: `http://${requireEnv("CLICKHOUSE_HOST", env)}:${requireEnv("CLICKHOUSE_PORT", env)}`,
      database: requireEnv("CLICKHOUSE_DATABASE", env),
      username: requireEnv("CLICKHOUSE_USER", env),
      password: requireEnv("CLICKHOUSE_PASSWORD", env),
    },
  };
}
