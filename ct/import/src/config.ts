import path from "node:path";

import type { CtFetchManifest } from "@/ct/types";

export type CtImportCliArgs = {
  manifestPath: string;
};

export type CtImportConfig = {
  manifestPath: string;
  clickhouse: {
    url: string;
    database: string;
    username: string;
    password: string;
  };
};

function readRequiredFlag(argv: string[], name: "--manifest") {
  const index = argv.findIndex((value) => value === name);

  if (index === -1 || !argv[index + 1]) {
    throw new Error(`Missing required flag: ${name}`);
  }

  return argv[index + 1] as string;
}

function requireEnv(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing required CT import environment variable: ${name}`);
  }

  return value;
}

export function parseCtImportCliArgs(argv: string[]): CtImportCliArgs {
  return {
    manifestPath: path.resolve(readRequiredFlag(argv, "--manifest")),
  };
}

export function readCtImportConfig(
  env: NodeJS.ProcessEnv,
  cliArgs: CtImportCliArgs,
): CtImportConfig {
  return {
    manifestPath: cliArgs.manifestPath,
    clickhouse: {
      url: `http://${requireEnv("CLICKHOUSE_HOST", env)}:${requireEnv("CLICKHOUSE_PORT", env)}`,
      database: requireEnv("CLICKHOUSE_DATABASE", env),
      username: requireEnv("CLICKHOUSE_USER", env),
      password: requireEnv("CLICKHOUSE_PASSWORD", env),
    },
  };
}

export type { CtFetchManifest };
