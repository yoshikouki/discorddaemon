#!/usr/bin/env bun
import { program } from "commander";
import { loadConfig } from "./config.ts";
import { createDaemon } from "./daemon.ts";

program
    .name("ddd")
    .description("Discord daemon with per-channel hooks")
    .version("0.1.0");

program
    .command("start")
    .description("Start the Discord daemon")
    .option("-c, --config <path>", "Path to ddd.toml", "ddd.toml")
    .action((opts: { config: string }) => {
        try {
            const config = loadConfig(opts.config);
            const daemon = createDaemon(config.bot.token, config.channels);

            process.on("SIGINT", () => {
                console.error("\n[ddd] Shutting down...");
                daemon.stop();
                process.exit(0);
            });

            process.on("SIGTERM", () => {
                console.error("[ddd] Received SIGTERM, shutting down...");
                daemon.stop();
                process.exit(0);
            });

            daemon.start();
        } catch (err) {
            console.error(`[ddd] ${err instanceof Error ? err.message : err}`);
            process.exit(1);
        }
    });

program
    .command("init")
    .description("Generate a sample ddd.toml")
    .action(() => {
        const sample = `[bot]
token = "" # or set DDD_TOKEN env var

[channels.general]
id = "CHANNEL_ID_HERE"
on_message = "./hooks/echo.sh"
`;
        console.log(sample);
    });

program.parse();
