import { createClient } from "@clickhouse/client";

import { parseTransformCliArgs, readBulkTransformConfig } from "./config";
import { ClickHouseBulkTransformRepository } from "./repository";
import { transformImportedSnapshot } from "./transformer";

async function main() {
  const cliArgs = parseTransformCliArgs(process.argv.slice(2));
  const config = readBulkTransformConfig(process.env, cliArgs);
  const client = createClient({
    url: config.clickhouse.url,
    database: config.clickhouse.database,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
  });

  try {
    const repository = new ClickHouseBulkTransformRepository({
      client,
    });
    const result = await transformImportedSnapshot({
      snapshotMonth: config.snapshotMonth,
      importVersion: config.importVersion,
      sourceKey: config.sourceKey,
      repository,
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
