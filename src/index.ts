#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { channelsCommand } from "./commands/channels";
import { initCommand } from "./commands/init";
import { startCommand } from "./commands/start";

const USAGE = `Usage: ddd <command>

Commands:
  start [-c path]      Start the daemon
  init                 Scaffold ddd.toml and hooks/
  channels [-c path]   List available Discord channels
`;

function fatal(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[ddd] ${message}`);
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
    case "channels": {
      const { values: channelsValues } = parseArgs({
        args: process.argv.slice(3),
        options: { config: { type: "string", short: "c" } },
      });
      channelsCommand({ config: channelsValues.config }).catch(fatal);
      break;
    }
    default:
      console.error(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main();
