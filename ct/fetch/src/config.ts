import path from "node:path";

export type CtFetchCliArgs = {
  date: string;
  storageRoot: string;
};

function readRequiredFlag(argv: string[], name: "--date" | "--storage-root") {
  const index = argv.findIndex((value) => value === name);

  if (index === -1 || !argv[index + 1]) {
    throw new Error(`Missing required flag: ${name}`);
  }

  return argv[index + 1] as string;
}

export function parseCtFetchCliArgs(argv: string[]): CtFetchCliArgs {
  return {
    date: readRequiredFlag(argv, "--date"),
    storageRoot: path.resolve(readRequiredFlag(argv, "--storage-root")),
  };
}
