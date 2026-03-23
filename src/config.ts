import type { ChannelConfig, Config } from "./types";

export async function loadConfig(path = "./ddd.toml"): Promise<Config> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${path}`);
  }

  const text = await file.text();
  const parsed = Bun.TOML.parse(text) as Record<string, unknown>;

  const bot = parsed.bot as Record<string, string> | undefined;
  const token = bot?.token || process.env.DDD_TOKEN;
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

  return { token, channels };
}
