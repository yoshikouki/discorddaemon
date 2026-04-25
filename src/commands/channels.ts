import {
  type Channel,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
} from "discord.js";
import { resolveToken } from "../config";
import {
  hybridChannelsFetcher,
  hybridCreateChannelExecutor,
  hybridDeleteChannelExecutor,
  hybridEditChannelExecutor,
} from "../ipc/executors";
import { probeDaemon } from "../ipc/probe";
import {
  validateEnum,
  validateMutuallyExclusive,
  validateRequired,
} from "../validators";

export interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  guild_id: string;
  guild_name: string;
  manageable: boolean;
  parent_id: string | null;
  parent_name: string | null;
  position: number | null;
  type: string;
}

export interface CreateChannelOptions {
  guildId: string;
  name: string;
  nsfw?: boolean;
  parentId?: string;
  position?: number;
  reason?: string;
  topic?: string;
  type: ChannelCreateType;
}

export interface EditChannelOptions {
  channelId: string;
  clearParent?: boolean;
  name?: string;
  nsfw?: boolean;
  parentId?: string;
  position?: number;
  reason?: string;
  topic?: string;
}

export interface DeleteChannelOptions {
  channelId: string;
  reason?: string;
}

export interface DispatcherValues {
  "clear-parent"?: boolean;
  config?: string;
  "guild-id"?: string;
  name?: string;
  "no-nsfw"?: boolean;
  nsfw?: boolean;
  "parent-id"?: string;
  position?: string;
  reason?: string;
  token?: string;
  topic?: string;
  type?: string;
}

export type ChannelCreateType = "announcement" | "text";

export const LISTABLE_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

export const MANAGEABLE_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

const VALID_CHANNEL_CREATE_TYPES = new Set<ChannelCreateType>([
  "announcement",
  "text",
]);

const CHANNEL_TYPE_MAP: Record<
  ChannelCreateType,
  ChannelType.GuildAnnouncement | ChannelType.GuildText
> = {
  text: ChannelType.GuildText,
  announcement: ChannelType.GuildAnnouncement,
};

const POSITION_ERROR_MESSAGE = "--position must be a non-negative integer";
const CREATE_TYPE_ERROR_MESSAGE = 'type must be "text" or "announcement"';
const INTEGER_POSITION_PATTERN = /^\d+$/;

export type ChannelFetcher = (token: string) => Promise<ChannelInfo[]>;
export type CreateChannelExecutor = (
  token: string,
  options: CreateChannelOptions
) => Promise<ChannelInfo>;
export type EditChannelExecutor = (
  token: string,
  options: EditChannelOptions
) => Promise<ChannelInfo>;
export type DeleteChannelExecutor = (
  token: string,
  options: DeleteChannelOptions
) => Promise<void>;

export function sortChannels(channels: ChannelInfo[]): ChannelInfo[] {
  return channels.sort(
    (a, b) =>
      a.guild_name.localeCompare(b.guild_name) ||
      (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER) ||
      a.channel_name.localeCompare(b.channel_name)
  );
}

function printChannel(channel: ChannelInfo): void {
  console.log(JSON.stringify(channel));
}

export function parseNsfwFlag(values: {
  "no-nsfw"?: boolean;
  nsfw?: boolean;
}): boolean | undefined {
  validateMutuallyExclusive(
    {
      nsfw: values.nsfw,
      noNsfw: values["no-nsfw"],
    },
    ["nsfw", "noNsfw"],
    "--nsfw and --no-nsfw are mutually exclusive"
  );

  if (values.nsfw) {
    return true;
  }
  if (values["no-nsfw"]) {
    return false;
  }
  return undefined;
}

async function resolveCommandToken(
  args: { config?: string; token?: string },
  probe: typeof probeDaemon
): Promise<string> {
  if (args.token) {
    return args.token;
  }

  const probeResult = await probe();
  if (probeResult.available) {
    return "";
  }

  return resolveToken({ config: args.config });
}

export function parsePosition(position?: unknown): number | undefined {
  if (position === undefined) {
    return undefined;
  }

  if (typeof position === "number") {
    if (!(Number.isInteger(position) && position >= 0)) {
      throw new Error(POSITION_ERROR_MESSAGE);
    }
    return position;
  }

  if (typeof position !== "string") {
    throw new Error(POSITION_ERROR_MESSAGE);
  }

  const trimmed = position.trim();
  if (!INTEGER_POSITION_PATTERN.test(trimmed)) {
    throw new Error(POSITION_ERROR_MESSAGE);
  }

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new Error(POSITION_ERROR_MESSAGE);
  }
  return value;
}

export function parseCreateType(type?: unknown): ChannelCreateType {
  if (type !== undefined && typeof type !== "string") {
    throw new Error(CREATE_TYPE_ERROR_MESSAGE);
  }

  const value = (type ?? "text") as ChannelCreateType;
  validateEnum(value, VALID_CHANNEL_CREATE_TYPES, CREATE_TYPE_ERROR_MESSAGE);
  return value;
}

export function hasEditChannelChanges(options: EditChannelOptions): boolean {
  return (
    options.name !== undefined ||
    options.topic !== undefined ||
    options.parentId !== undefined ||
    options.clearParent === true ||
    options.position !== undefined ||
    options.nsfw !== undefined
  );
}

type ManagedChannelShape = GuildBasedChannel & {
  guild: {
    id: string;
    name: string;
    channels: {
      edit: (
        channelId: string,
        options: {
          name?: string;
          nsfw?: boolean;
          parent?: string | null;
          position?: number;
          reason?: string;
          topic?: string;
        }
      ) => Promise<GuildBasedChannel>;
    };
  };
  name: string;
  parent?: { name: string } | null;
  parentId?: string | null;
  position?: number;
  type: ChannelType;
  delete: (reason?: string) => Promise<unknown>;
};

function toManagedChannel(
  channel: Channel | null,
  channelId: string
): ManagedChannelShape {
  if (!(channel && MANAGEABLE_CHANNEL_TYPES.has(channel.type))) {
    throw new Error(
      `Channel ${channelId} must be a text or announcement channel`
    );
  }

  return channel as ManagedChannelShape;
}

export function toChannelInfo(
  guild: { id: string; name: string },
  channel: {
    id: string;
    name: string;
    type: ChannelType;
    parentId?: string | null;
    parent?: { name: string } | null;
  },
  position: number | null
): ChannelInfo {
  return {
    guild_id: guild.id,
    guild_name: guild.name,
    channel_id: channel.id,
    channel_name: channel.name,
    manageable: MANAGEABLE_CHANNEL_TYPES.has(channel.type),
    type: ChannelType[channel.type],
    parent_id: channel.parentId ?? null,
    parent_name: channel.parent?.name ?? null,
    position,
  };
}

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
      const seen = new Set<string>();

      for (const channel of guild.channels.cache.values()) {
        if (!LISTABLE_CHANNEL_TYPES.has(channel.type)) {
          continue;
        }
        seen.add(channel.id);
        const pos = "position" in channel ? (channel.position as number) : null;
        channels.push(toChannelInfo(guild, channel, pos));
      }

      const activeThreads = guild.channels.fetchActiveThreads;
      if (typeof activeThreads !== "function") {
        continue;
      }

      const { threads } = await activeThreads.call(guild.channels);
      for (const thread of threads.values()) {
        if (
          !(LISTABLE_CHANNEL_TYPES.has(thread.type) && !seen.has(thread.id))
        ) {
          continue;
        }
        channels.push(toChannelInfo(guild, thread, null));
      }
    }

    return sortChannels(channels);
  } finally {
    client.destroy();
  }
}

export async function createChannelImpl(
  client: Client<true>,
  options: CreateChannelOptions
): Promise<ChannelInfo> {
  const guild = await client.guilds.fetch(options.guildId);
  const channel = await guild.channels.create({
    name: options.name,
    type: CHANNEL_TYPE_MAP[options.type],
    parent: options.parentId,
    topic: options.topic,
    position: options.position,
    nsfw: options.nsfw,
    reason: options.reason,
  } satisfies GuildChannelCreateOptions);

  const position = "position" in channel ? (channel.position as number) : null;
  return toChannelInfo(guild, channel, position);
}

export async function editChannelImpl(
  client: Client<true>,
  options: EditChannelOptions
): Promise<ChannelInfo> {
  const channel = toManagedChannel(
    await client.channels.fetch(options.channelId),
    options.channelId
  );

  const updated = (await channel.guild.channels.edit(channel.id, {
    name: options.name,
    topic: options.topic,
    parent: options.clearParent ? null : options.parentId,
    position: options.position,
    nsfw: options.nsfw,
    reason: options.reason,
  })) as GuildBasedChannel & {
    name: string;
    parent?: { name: string } | null;
    parentId?: string | null;
    position?: number;
    type: ChannelType;
  };

  return toChannelInfo(channel.guild, updated, updated.position ?? null);
}

export async function deleteChannelImpl(
  client: Client<true>,
  options: DeleteChannelOptions
): Promise<void> {
  const channel = toManagedChannel(
    await client.channels.fetch(options.channelId),
    options.channelId
  );
  await channel.delete(options.reason);
}

export async function listChannels(
  args: { config?: string; token?: string },
  fetcher: ChannelFetcher = hybridChannelsFetcher,
  probe: typeof probeDaemon = probeDaemon
): Promise<void> {
  const token = await resolveCommandToken(args, probe);
  const channels = await fetcher(token);

  for (const channel of channels) {
    printChannel(channel);
  }
}

export async function createChannel(
  args: { config?: string; token?: string } & CreateChannelOptions,
  executor: CreateChannelExecutor = hybridCreateChannelExecutor,
  probe: typeof probeDaemon = probeDaemon
): Promise<void> {
  const token = await resolveCommandToken(args, probe);
  const channel = await executor(token, {
    guildId: args.guildId,
    name: args.name,
    type: args.type,
    parentId: args.parentId,
    topic: args.topic,
    position: args.position,
    nsfw: args.nsfw,
    reason: args.reason,
  });
  printChannel(channel);
}

export async function editChannel(
  args: { config?: string; token?: string } & EditChannelOptions,
  executor: EditChannelExecutor = hybridEditChannelExecutor,
  probe: typeof probeDaemon = probeDaemon
): Promise<void> {
  if (!hasEditChannelChanges(args)) {
    throw new Error("At least one field to edit is required");
  }

  const token = await resolveCommandToken(args, probe);
  const channel = await executor(token, {
    channelId: args.channelId,
    name: args.name,
    topic: args.topic,
    parentId: args.parentId,
    clearParent: args.clearParent,
    position: args.position,
    nsfw: args.nsfw,
    reason: args.reason,
  });
  printChannel(channel);
}

export async function deleteChannel(
  args: { config?: string; token?: string } & DeleteChannelOptions,
  executor: DeleteChannelExecutor = hybridDeleteChannelExecutor,
  probe: typeof probeDaemon = probeDaemon
): Promise<void> {
  const token = await resolveCommandToken(args, probe);
  await executor(token, {
    channelId: args.channelId,
    reason: args.reason,
  });
}

export async function channelsCommand(
  positionals: string[],
  values: DispatcherValues,
  executors: {
    create?: CreateChannelExecutor;
    delete?: DeleteChannelExecutor;
    edit?: EditChannelExecutor;
    list?: ChannelFetcher;
    probe?: typeof probeDaemon;
  } = {}
): Promise<void> {
  const subcommand = positionals[0] ?? "list";
  const probe = executors.probe ?? probeDaemon;

  switch (subcommand) {
    case "list":
      await listChannels(
        { config: values.config, token: values.token },
        executors.list,
        probe
      );
      break;

    case "create": {
      const name = positionals[1];
      if (!(name && values["guild-id"])) {
        throw new Error(
          "Usage: ddd channels create <name> --guild-id <guild_id>"
        );
      }

      await createChannel(
        {
          config: values.config,
          token: values.token,
          guildId: values["guild-id"],
          name,
          type: parseCreateType(values.type),
          parentId: values["parent-id"],
          topic: values.topic,
          position: parsePosition(values.position),
          nsfw: parseNsfwFlag(values),
          reason: values.reason,
        },
        executors.create,
        probe
      );
      break;
    }

    case "edit": {
      const channelId = positionals[1];
      if (!channelId) {
        throw new Error("Usage: ddd channels edit <channel_id> [flags]");
      }

      validateMutuallyExclusive(
        {
          parentId: values["parent-id"],
          clearParent: values["clear-parent"],
        },
        ["parentId", "clearParent"],
        "--parent-id and --clear-parent are mutually exclusive"
      );

      await editChannel(
        {
          config: values.config,
          token: values.token,
          channelId,
          name: values.name,
          topic: values.topic,
          parentId: values["parent-id"],
          clearParent: values["clear-parent"],
          position: parsePosition(values.position),
          nsfw: parseNsfwFlag(values),
          reason: values.reason,
        },
        executors.edit,
        probe
      );
      break;
    }

    case "delete": {
      const channelId = positionals[1];
      validateRequired(channelId, "Usage: ddd channels delete <channel_id>");
      await deleteChannel(
        {
          config: values.config,
          token: values.token,
          channelId,
          reason: values.reason,
        },
        executors.delete,
        probe
      );
      break;
    }

    default:
      throw new Error("Usage: ddd channels <list|create|edit|delete> ...");
  }
}
