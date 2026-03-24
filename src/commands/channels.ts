import { ChannelType, Client, Events, GatewayIntentBits } from "discord.js";
import { resolveToken } from "../config";

export interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  guild_id: string;
  guild_name: string;
  parent_id: string | null;
  parent_name: string | null;
  position: number | null;
  type: string;
}

const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
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
          parent_id: "parentId" in channel ? (channel.parentId ?? null) : null,
          parent_name: channel.parent?.name ?? null,
          position: "position" in channel ? channel.position : null,
        });
      }
    }

    channels.sort(
      (a, b) =>
        a.guild_name.localeCompare(b.guild_name) ||
        (a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.channel_name.localeCompare(b.channel_name)
    );

    return channels;
  } finally {
    client.destroy();
  }
}

export async function channelsCommand(
  args: { config?: string; token?: string },
  fetcher: ChannelFetcher = fetchDiscordChannels
): Promise<void> {
  const token = await resolveToken({ token: args.token, config: args.config });
  const channels = await fetcher(token);

  for (const ch of channels) {
    console.log(JSON.stringify(ch));
  }
}
