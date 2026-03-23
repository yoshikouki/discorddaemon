import { parseTOML } from "./toml";
import type { ChannelConfig, Config } from "./types";

const CHANNELS_PREFIX = "channels.";

export function parseConfig(text: string, envToken?: string): Config {
  const parsed = parseTOML(text);

  const token = parsed.bot?.token || envToken;
  if (!token) {
    throw new Error(
      "Bot token is required: set [bot] token in ddd.toml or DDD_TOKEN env var"
    );
  }

  const channels = new Map<string, ChannelConfig>();

  for (const [section, values] of Object.entries(parsed)) {
    if (!section.startsWith(CHANNELS_PREFIX)) {
      continue;
    }

    const name = section.slice(CHANNELS_PREFIX.length);
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

  return { token, channels };
}

export async function loadConfig(path = "./ddd.toml"): Promise<Config> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${path}`);
  }

  const text = await file.text();
  return parseConfig(text, process.env.DDD_TOKEN);
}
