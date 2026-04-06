#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { channelsCommand } from "./commands/channels";
import { initCommand } from "./commands/init";
import { messagesCommand } from "./commands/messages";
import { startCommand } from "./commands/start";
import { statusCommand } from "./commands/status";
import { stopCommand } from "./commands/stop";

const USAGE = `Usage: ddd <command>

Commands:
  start [-c path] [-f]                                   Start the daemon (background by default)
  stop                                                   Stop the daemon
  status                                                 Check if the daemon is running
  init                                                   Scaffold ~/.config/ddd/ config and hooks
  channels [-c path] [-t token]                          List available Discord channels
  messages list <channel_id> [-n limit]                  Fetch messages from a channel
  messages send <channel_id> [-m content]                Send a message to a channel
  messages edit <channel_id> <message_id> [-m content]   Edit a message
  messages delete <channel_id> <message_id>              Delete a message
  messages react <channel_id> <message_id> <emoji>       Add a reaction to a message
  messages search <guild_id> [--content text] [flags]    Search messages across a guild
  messages recent [guild_id] [-n limit]                  Fetch recent messages across a guild
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
        options: {
          config: { type: "string", short: "c" },
          foreground: { type: "boolean", short: "f", default: false },
        },
      });
      startCommand({
        config: values.config,
        foreground: values.foreground,
      }).catch(fatal);
      break;
    }
    case "stop":
      stopCommand().catch(fatal);
      break;
    case "status":
      statusCommand().catch(fatal);
      break;
    case "init":
      initCommand().catch(fatal);
      break;
    case "channels": {
      const { values: channelsValues } = parseArgs({
        args: process.argv.slice(3),
        options: {
          config: { type: "string", short: "c" },
          token: { type: "string", short: "t" },
        },
      });
      channelsCommand({
        config: channelsValues.config,
        token: channelsValues.token,
      }).catch(fatal);
      break;
    }
    case "messages": {
      const { values: messagesValues, positionals } = parseArgs({
        args: process.argv.slice(3),
        options: {
          config: { type: "string", short: "c" },
          content: { type: "string", short: "m" },
          limit: { type: "string", short: "n" },
          before: { type: "string" },
          after: { type: "string" },
          around: { type: "string" },
          "author-id": { type: "string", multiple: true },
          "author-type": { type: "string" },
          "channel-id": { type: "string", multiple: true },
          has: { type: "string" },
          offset: { type: "string" },
        },
        allowPositionals: true,
      });
      messagesCommand(positionals, messagesValues).catch(fatal);
      break;
    }
    default:
      console.error(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main();
