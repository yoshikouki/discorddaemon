import type { Message } from "discord.js";

export interface MessageInfo {
  author: {
    id: string;
    username: string;
    bot: boolean;
  };
  channel: {
    id: string;
    name: string | null;
  };
  content: string;
  editedTimestamp: string | null;
  guild: {
    id: string;
    name: string;
  } | null;
  id: string;
  pinned: boolean;
  timestamp: string;
  type: number;
}

export function buildMessageInfo(message: Message): MessageInfo {
  return {
    id: message.id,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot,
    },
    channel: {
      id: message.channelId,
      name: "name" in message.channel ? message.channel.name : null,
    },
    guild: message.guild
      ? { id: message.guild.id, name: message.guild.name }
      : null,
    timestamp: message.createdAt.toISOString(),
    editedTimestamp: message.editedTimestamp
      ? new Date(message.editedTimestamp).toISOString()
      : null,
    pinned: message.pinned,
    type: message.type,
  };
}
