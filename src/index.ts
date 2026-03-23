#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { initCommand } from "./commands/init";
import { startCommand } from "./commands/start";

const USAGE = `Usage: ddd <command>

Commands:
  start [-c path]   Start the daemon
  init              Scaffold ddd.toml and hooks/
`;

function fatal(err: unknown): never {
  console.error("[ddd]", err);
  process.exit(1);
}

function main(): void {
  const command = process.argv[2];

  switch (command) {
    case "start": {
      const { values } = parseArgs({
        args: process.argv.slice(3),
        options: { config: { type: "string", short: "c" } },
      });
      startCommand({ config: values.config }).catch(fatal);
      break;
    }
    case "init":
      initCommand().catch(fatal);
      break;
    default:
      console.error(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main();
