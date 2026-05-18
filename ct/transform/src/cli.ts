import { createClient } from "@clickhouse/client";

import { parseCtTransformCliArgs, readCtTransformConfig } from "./config";
import { ClickHouseCtTransformRepository } from "./repository";
import { transformCtImport } from "./transformer";

async function main() {
  const cliArgs = parseCtTransformCliArgs(process.argv.slice(2));
  const config = readCtTransformConfig(process.env, cliArgs);
  const client = createClient({
    url: config.clickhouse.url,
    database: config.clickhouse.database,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
  });

  try {
    const repository = new ClickHouseCtTransformRepository({ client });
    const result = await transformCtImport({
      dumpDate: config.dumpDate,
      importVersion: config.importVersion,
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
