import { createClient } from "@clickhouse/client";

import { parseImportCliArgs, readBulkImportConfig } from "./config";
import { importSnapshotToClickHouse } from "./importer";
import { ClickHouseBulkImportRepository } from "./repository";

async function main() {
  const cliArgs = parseImportCliArgs(process.argv.slice(2));
  const config = readBulkImportConfig(process.env, cliArgs);
  const client = createClient({
    url: config.clickhouse.url,
    database: config.clickhouse.database,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
  });

  try {
    const repository = new ClickHouseBulkImportRepository({
      client,
    });
    const result = await importSnapshotToClickHouse({
      manifestPath: config.manifestPath,
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
