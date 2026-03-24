import { ChannelType, Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig } from "../config";

export interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  guild_id: string;
  guild_name: string;
  parent_name: string | null;
  position: number;
  type: string;
}

const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

export type ChannelFetcher = (token: string) => Promise<ChannelInfo[]>;

export async function fetchDiscordChannels(
  token: string
): Promise<ChannelInfo[]> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  try {
    await new Promise<void>((resolve, reject) => {
      client.once(Events.ClientReady, () => resolve());
      client.once(Events.Error, reject);
      client.login(token).catch(reject);
    });

    const channels: ChannelInfo[] = [];

    for (const guild of client.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (!TEXT_CHANNEL_TYPES.has(channel.type)) {
          continue;
        }

        channels.push({
          guild_id: guild.id,
          guild_name: guild.name,
          channel_id: channel.id,
          channel_name: channel.name,
          type: ChannelType[channel.type],
          parent_name: channel.parent?.name ?? null,
          position: channel.position,
        });
      }
    }

    channels.sort(
      (a, b) =>
        a.guild_name.localeCompare(b.guild_name) || a.position - b.position
    );

    return channels;
  } finally {
    client.destroy();
  }
}

export async function channelsCommand(
  args: { config?: string },
  fetcher: ChannelFetcher = fetchDiscordChannels
): Promise<void> {
  const config = await loadConfig(args.config);
  const channels = await fetcher(config.token);

  for (const ch of channels) {
    console.log(JSON.stringify(ch));
  }
}
