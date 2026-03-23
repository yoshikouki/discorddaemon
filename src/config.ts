import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "smol-toml";
import type { Config } from "./types.ts";

const DEFAULT_CONFIG_PATH = "ddd.toml";

export function loadConfig(configPath?: string): Config {
    const filePath = resolve(configPath ?? DEFAULT_CONFIG_PATH);

    if (!existsSync(filePath)) {
        throw new Error(`Config file not found: ${filePath}`);
    }

    const raw = readFileSync(filePath, "utf-8");
    const parsed = parse(raw);

    const token =
        (parsed.bot as Record<string, unknown>)?.token ?? process.env.DDD_TOKEN;

    if (!token || typeof token !== "string") {
        throw new Error(
            "Bot token is required. Set [bot].token in ddd.toml or DDD_TOKEN env var.",
        );
    }

    const channels: Config["channels"] = {};
    const rawChannels = parsed.channels as
        | Record<string, Record<string, unknown>>
        | undefined;

    if (rawChannels) {
        for (const [name, ch] of Object.entries(rawChannels)) {
            if (
                typeof ch.id !== "string" ||
                typeof ch.on_message !== "string"
            ) {
                throw new Error(
                    `Invalid channel config for "${name}": id and on_message are required strings.`,
                );
            }
            channels[name] = {
                id: ch.id,
                on_message: ch.on_message,
            };
        }
    }

    return {
        bot: { token: token as string },
        channels,
    };
}
