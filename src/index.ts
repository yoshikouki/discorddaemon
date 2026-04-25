#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { channelsCommand } from "./commands/channels";
import { initCommand } from "./commands/init";
import { installServiceCommand } from "./commands/install-service";
import { messagesCommand } from "./commands/messages";
import { startCommand } from "./commands/start";
import { statusCommand } from "./commands/status";
import { stopCommand } from "./commands/stop";
import { uninstallServiceCommand } from "./commands/uninstall-service";

const USAGE = `Usage: ddd <command>

Commands:
  start [-c path] [-f]                                   Start the daemon or service
  stop                                                   Stop the daemon or service
  status                                                 Check daemon/service status
  install-service                                        Install user service files
  uninstall-service                                      Remove user service files
  init                                                   Scaffold ~/.config/ddd/ config and hooks
  channels [list] [-c path] [-t token]                   List available Discord channels
  channels create <name> --guild-id <guild_id> [flags]   Create a text or announcement channel
  channels edit <channel_id> [flags]                     Edit a text or announcement channel
  channels delete <channel_id> [--reason text]           Delete a text or announcement channel
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
    case "install-service":
      installServiceCommand().catch(fatal);
      break;
    case "uninstall-service":
      uninstallServiceCommand().catch(fatal);
      break;
    case "init":
      initCommand().catch(fatal);
      break;
    case "channels": {
      const { values: channelsValues, positionals } = parseArgs({
        args: process.argv.slice(3),
        options: {
          "clear-parent": { type: "boolean" },
          config: { type: "string", short: "c" },
          "guild-id": { type: "string" },
          name: { type: "string" },
          "no-nsfw": { type: "boolean" },
          nsfw: { type: "boolean" },
          "parent-id": { type: "string" },
          position: { type: "string" },
          reason: { type: "string" },
          token: { type: "string", short: "t" },
          topic: { type: "string" },
          type: { type: "string" },
        },
        allowNegative: true,
        allowPositionals: true,
      });
      channelsCommand(positionals, channelsValues).catch(fatal);
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
