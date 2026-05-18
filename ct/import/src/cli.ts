import { createClient } from "@clickhouse/client";

import { parseCtImportCliArgs, readCtImportConfig } from "./config";
import { importCtDumpToClickHouse } from "./importer";
import { ClickHouseCtImportRepository } from "./repository";

async function main() {
  const cliArgs = parseCtImportCliArgs(process.argv.slice(2));
  const config = readCtImportConfig(process.env, cliArgs);
  const client = createClient({
    url: config.clickhouse.url,
    database: config.clickhouse.database,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
  });

  try {
    const repository = new ClickHouseCtImportRepository({ client });
    const result = await importCtDumpToClickHouse({
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
