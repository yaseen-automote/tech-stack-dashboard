type RequiredVariable =
  | "BULK_SNAPSHOT_STORAGE_PATH"
  | "BULK_ACTIVE_SNAPSHOT_MONTH"
  | "CLICKHOUSE_HOST"
  | "CLICKHOUSE_PORT"
  | "CLICKHOUSE_DATABASE"
  | "CLICKHOUSE_USER"
  | "CLICKHOUSE_PASSWORD"
  | "HONO_HOST"
  | "HONO_PORT";

export type BulkApiConfig = {
  snapshotStoragePath: string;
  activeSnapshotMonth: string;
  clickhouse: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  hono: {
    host: string;
    port: number;
  };
  thc: {
    baseUrl: string;
    apiKey?: string;
  };
};

function requireEnv(name: RequiredVariable) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required bulk API environment variable: ${name}`);
  }

  return value;
}

export function readBulkConfig(): BulkApiConfig {
  const clickhousePort = Number(requireEnv("CLICKHOUSE_PORT"));
  const honoPort = Number(requireEnv("HONO_PORT"));

  if (Number.isNaN(clickhousePort) || Number.isNaN(honoPort)) {
    throw new Error("CLICKHOUSE_PORT and HONO_PORT must be valid numbers.");
  }

  return {
    snapshotStoragePath: requireEnv("BULK_SNAPSHOT_STORAGE_PATH"),
    activeSnapshotMonth: requireEnv("BULK_ACTIVE_SNAPSHOT_MONTH"),
    clickhouse: {
      host: requireEnv("CLICKHOUSE_HOST"),
      port: clickhousePort,
      database: requireEnv("CLICKHOUSE_DATABASE"),
      user: requireEnv("CLICKHOUSE_USER"),
      password: requireEnv("CLICKHOUSE_PASSWORD"),
    },
    hono: {
      host: requireEnv("HONO_HOST"),
      port: honoPort,
    },
    thc: {
      baseUrl: process.env.THC_API_BASE_URL || "https://ip.thc.org",
      apiKey: process.env.THC_API_KEY,
    },
  };
}
