import { parseCtFetchCliArgs } from "./config";
import { fetchCtDumpForDate } from "./fetcher";

async function main() {
  const cliArgs = parseCtFetchCliArgs(process.argv.slice(2));
  const result = await fetchCtDumpForDate({
    targetDate: cliArgs.date,
    storageRoot: cliArgs.storageRoot,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
