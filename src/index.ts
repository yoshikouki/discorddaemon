#!/usr/bin/env bun
import { parseCliArgs } from "./cli.ts";
import { loadConfig } from "./config.ts";
import { createDaemon } from "./daemon.ts";

const sample = `[bot]
token = "" # or set DDD_TOKEN env var

[channels.general]
id = "CHANNEL_ID_HERE"
on_message = "./hooks/echo.sh"
`;

function installSignalHandlers(stop: () => void): void {
  process.on("SIGINT", () => {
    console.error("\n[ddd] Shutting down...");
    stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.error("[ddd] Received SIGTERM, shutting down...");
    stop();
    process.exit(0);
  });
}

try {
  const command = parseCliArgs(process.argv.slice(2));

  if (command.name === "init") {
    console.log(sample);
  } else {
    const config = loadConfig(command.configPath);
    const daemon = createDaemon(config.bot.token, config.channels);

    installSignalHandlers(() => daemon.stop());
    daemon.start();
  }
} catch (err) {
  console.error(`[ddd] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
