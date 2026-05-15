import { createClient } from "@clickhouse/client";
import { serve } from "@hono/node-server";

import { createBulkApiApp } from "./app";
import { readBulkConfig } from "./config";
import { ClickHouseBulkApiRepository } from "./repository";
import { createBulkApiLookupService } from "./service";

const config = readBulkConfig();
const clickhouseClient = createClient({
  host: `http://${config.clickhouse.host}:${config.clickhouse.port}`,
  database: config.clickhouse.database,
  username: config.clickhouse.user,
  password: config.clickhouse.password,
});
const repository = new ClickHouseBulkApiRepository({
  client: clickhouseClient,
});
const lookupService = createBulkApiLookupService({
  config,
  repository,
  fetch,
});
const app = createBulkApiApp({
  config,
  lookupService,
});

serve(
  {
    fetch: app.fetch,
    hostname: config.hono.host,
    port: config.hono.port,
  },
  (info) => {
    console.log(`bulk-api listening on http://${info.address}:${info.port}`);
  },
);
