import { createClient } from "@clickhouse/client";
import { ClickHouseBulkTransformRepository } from "./repository";
import { rebuildDiscoveryLookups } from "./rebuild-lookups";

async function main() {
  const client = createClient({
    url: process.env.CLICKHOUSE_URL ?? `http://${process.env.CLICKHOUSE_HOST ?? "127.0.0.1"}:${process.env.CLICKHOUSE_PORT ?? "8123"}`,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE,
  });

  const repository = new ClickHouseBulkTransformRepository({ client });

  try {
    const result = await rebuildDiscoveryLookups({ repository });
    console.log(`Rebuild complete: ${result.apexCount} apex rows, ${result.subdomainCount} subdomain rows`);
  } catch (error) {
    console.error("Rebuild failed:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
