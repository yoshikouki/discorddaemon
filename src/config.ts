import { dirname, resolve } from "node:path";
import { CONFIG_PATH } from "./paths";
import type { ChannelConfig, Config } from "./types";

export async function resolveToken(opts?: {
  token?: string;
  config?: string;
}): Promise<string> {
  if (opts?.token) {
    return opts.token;
  }

  const envToken = process.env.DDD_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  const configPath = resolve(opts?.config ?? CONFIG_PATH);
  const file = Bun.file(configPath);
  if (await file.exists()) {
    const text = await file.text();
    const parsed = Bun.TOML.parse(text) as Record<string, unknown>;
    const bot = parsed.bot as Record<string, string> | undefined;
    if (bot?.token && typeof bot.token === "string" && bot.token.trim()) {
      return bot.token;
    }
  }

  throw new Error(
    "Bot token is required: pass -t token, set DDD_TOKEN env var, or set [bot] token in ddd.toml"
  );
}

export async function loadConfig(path = CONFIG_PATH): Promise<Config> {
  const resolvedPath = resolve(path);
  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const text = await file.text();
  const parsed = Bun.TOML.parse(text) as Record<string, unknown>;

  const bot = parsed.bot as Record<string, string> | undefined;
  const token = bot?.token || process.env.DDD_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Bot token is required: set [bot] token in ddd.toml or DDD_TOKEN env var"
    );
  }

  const channels = new Map<string, ChannelConfig>();
  const channelsObj = parsed.channels as
    | Record<string, Record<string, string>>
    | undefined;

  if (channelsObj) {
    for (const [name, values] of Object.entries(channelsObj)) {
      const id = values?.id;
      const onMessage = values?.on_message;

      if (!id) {
        throw new Error(`Channel "${name}" is missing required field: id`);
      }
      if (!onMessage) {
        throw new Error(
          `Channel "${name}" is missing required field: on_message`
        );
      }

      channels.set(id, { id, name, on_message: onMessage });
    }
  }

  const defaultGuild =
    typeof bot?.default_guild === "string" && bot.default_guild.trim()
      ? bot.default_guild.trim()
      : undefined;

  const configDir = dirname(resolvedPath);
  return { token, channels, configDir, defaultGuild };
}
