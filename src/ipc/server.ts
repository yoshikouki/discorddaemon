import { existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Socket } from "bun";
import type { Client } from "discord.js";
import {
  type ChannelInfo,
  TEXT_CHANNEL_TYPES,
  toChannelInfo,
} from "../commands/channels";
import {
  deleteMessageImpl,
  editMessageImpl,
  listMessagesImpl,
  reactMessageImpl,
  recentMessagesImpl,
  searchMessagesImpl,
  sendMessageImpl,
} from "../commands/messages";
import { resolveGuildFromCache } from "../guild";
import { SOCKET_PATH } from "../paths";
import type { DaemonStats } from "../stats";
import {
  VALID_AUTHOR_TYPES,
  VALID_HAS_VALUES,
  validateEnum,
  validateLimit,
  validateMutuallyExclusive,
  validateOffset,
  validateRequired,
  validateSearchFilters,
} from "../validators";
import type {
  ChannelsListParams,
  GuildResolveParams,
  IpcRequest,
  IpcResponse,
  MessagesDeleteParams,
  MessagesEditParams,
  MessagesListParams,
  MessagesReactParams,
  MessagesRecentParams,
  MessagesSearchParams,
  MessagesSendParams,
} from "./protocol";

export interface IpcServerOptions {
  statsProvider?: () => DaemonStats | null;
}

export class IpcServer {
  private server: ReturnType<typeof Bun.listen> | null = null;
  private readonly client: Client<true>;
  private readonly startTime: number;
  private readonly tokenFingerprint: string;
  private readonly socketPath: string;
  private readonly buffers = new Map<Socket<undefined>, string>();
  private readonly statsProvider: (() => DaemonStats | null) | null;

  constructor(
    client: Client<true>,
    token: string,
    socketPath?: string,
    options?: IpcServerOptions
  ) {
    this.client = client;
    this.startTime = Date.now();
    this.socketPath = socketPath ?? SOCKET_PATH;
    this.statsProvider = options?.statsProvider ?? null;
    // First 8 chars of SHA-256 hash — used by probe for token verification
    const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
    this.tokenFingerprint = hash.slice(0, 8);
  }

  async start(): Promise<void> {
    // Ensure directory exists with mode 0700
    const socketDir = dirname(this.socketPath);
    mkdirSync(socketDir, { recursive: true, mode: 0o700 });

    // If socket path exists, verify it is actually a socket before removing
    if (existsSync(this.socketPath)) {
      const stat = lstatSync(this.socketPath);
      if (!stat.isSocket()) {
        throw new Error(
          `${this.socketPath} exists but is not a socket — refusing to overwrite`
        );
      }
      // Check if another daemon is listening (socket is live, not stale)
      const alive = await this.isSocketConnectable();
      if (alive) {
        throw new Error(
          `Another daemon is already listening on ${this.socketPath} — refusing to start`
        );
      }
      // Stale socket from a crashed daemon — safe to remove
      unlinkSync(this.socketPath);
    }

    this.server = Bun.listen({
      unix: this.socketPath,
      socket: {
        data: (socket, data) => {
          this.handleData(socket, data);
        },
        close: (socket) => {
          this.handleClose(socket);
        },
        error: (_socket, error) => {
          console.error(`[ddd] IPC socket error: ${error.message}`);
        },
      },
    });

    console.error(`[ddd] IPC server listening on ${this.socketPath}`);
  }

  /**
   * Socket security relies on filesystem permissions of the data directory
   * (mode 0700). Only the owning user can connect.
   */
  private isSocketConnectable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 500);
      Bun.connect({
        unix: this.socketPath,
        socket: {
          open(socket) {
            clearTimeout(timeout);
            socket.end();
            resolve(true);
          },
          error() {
            clearTimeout(timeout);
            resolve(false);
          },
          data() {
            // not used for connectivity check
          },
          close() {
            // not used for connectivity check
          },
        },
      }).catch(() => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  stop(): void {
    this.server?.stop();
    this.buffers.clear();
    // Clean up socket file
    try {
      unlinkSync(this.socketPath);
    } catch {
      // best-effort
    }
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  getTokenFingerprint(): string {
    return this.tokenFingerprint;
  }

  private handleData(socket: Socket<undefined>, data: Buffer): void {
    const existing = this.buffers.get(socket) ?? "";
    const combined = existing + data.toString();
    const parts = combined.split("\n");
    this.buffers.set(socket, parts.pop() ?? ""); // keep incomplete line

    for (const line of parts) {
      if (!line.trim()) {
        continue;
      }
      this.handleLine(socket, line);
    }
  }

  private handleClose(socket: Socket<undefined>): void {
    this.buffers.delete(socket);
  }

  private async handleLine(
    socket: Socket<undefined>,
    line: string
  ): Promise<void> {
    let request: IpcRequest;
    try {
      request = JSON.parse(line);
    } catch {
      const response: IpcResponse = { id: "", error: "Invalid JSON" };
      socket.write(`${JSON.stringify(response)}\n`);
      return;
    }

    try {
      const result = await this.dispatch(request);
      const response: IpcResponse = { id: request.id, result };
      socket.write(`${JSON.stringify(response)}\n`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const response: IpcResponse = { id: request.id, error: message };
      socket.write(`${JSON.stringify(response)}\n`);
    }
  }

  private dispatch(request: IpcRequest): unknown {
    switch (request.method) {
      case "daemon/ping":
        return {
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          pid: process.pid,
        };

      case "daemon/info": {
        const stats = this.statsProvider?.() ?? undefined;
        return {
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          pid: process.pid,
          tokenFingerprint: this.tokenFingerprint,
          ...stats,
        };
      }

      case "daemon/stats":
        return this.statsProvider?.() ?? {};

      case "messages/list":
        return this.handleMessagesList(request.params as MessagesListParams);

      case "messages/send":
        return this.handleMessagesSend(request.params as MessagesSendParams);

      case "messages/edit":
        return this.handleMessagesEdit(request.params as MessagesEditParams);

      case "messages/delete":
        return this.handleMessagesDelete(
          request.params as MessagesDeleteParams
        );

      case "messages/react":
        return this.handleMessagesReact(request.params as MessagesReactParams);

      case "messages/search":
        return this.handleMessagesSearch(
          request.params as MessagesSearchParams
        );

      case "messages/recent":
        return this.handleMessagesRecent(
          request.params as MessagesRecentParams
        );

      case "guild/resolve":
        return this.handleGuildResolve(request.params as GuildResolveParams);

      case "channels/list":
        return this.handleChannelsList(request.params as ChannelsListParams);

      default:
        throw new Error(`Unknown method: ${request.method}`);
    }
  }

  private handleMessagesList(params: MessagesListParams) {
    validateRequired(params.channelId, "channelId is required");
    validateLimit(params.limit ?? 50, 1, 100);
    validateMutuallyExclusive(
      { before: params.before, after: params.after, around: params.around },
      ["before", "after", "around"],
      "--before, --after, and --around are mutually exclusive"
    );

    return listMessagesImpl(this.client, params.channelId, {
      limit: params.limit ?? 50,
      before: params.before,
      after: params.after,
      around: params.around,
    });
  }

  private handleMessagesSend(params: MessagesSendParams) {
    validateRequired(params.channelId, "channelId is required");
    validateRequired(params.content, "content is required");
    if (!params.content.trim()) {
      throw new Error("Content must not be empty");
    }

    return sendMessageImpl(this.client, params.channelId, params.content);
  }

  private handleMessagesEdit(params: MessagesEditParams) {
    validateRequired(params.channelId, "channelId is required");
    validateRequired(params.messageId, "messageId is required");
    validateRequired(params.content, "content is required");
    if (!params.content.trim()) {
      throw new Error("Content must not be empty");
    }

    return editMessageImpl(
      this.client,
      params.channelId,
      params.messageId,
      params.content
    );
  }

  private handleMessagesDelete(params: MessagesDeleteParams) {
    validateRequired(params.channelId, "channelId is required");
    validateRequired(params.messageId, "messageId is required");

    return deleteMessageImpl(this.client, params.channelId, params.messageId);
  }

  private handleMessagesReact(params: MessagesReactParams) {
    validateRequired(params.channelId, "channelId is required");
    validateRequired(params.messageId, "messageId is required");
    validateRequired(params.emoji, "emoji is required");

    return reactMessageImpl(
      this.client,
      params.channelId,
      params.messageId,
      params.emoji
    );
  }

  private handleMessagesSearch(params: MessagesSearchParams) {
    validateRequired(params.guildId, "guildId is required");
    validateLimit(params.limit ?? 25, 1, 25);
    validateOffset(params.offset ?? 0);

    const trimmedContent = params.content?.trim() || undefined;
    const authorIds = params.authorIds ?? [];
    const channelIds = params.channelIds ?? [];

    validateSearchFilters({
      content: trimmedContent,
      authorIds,
      authorType: params.authorType,
      channelIds,
      has: params.has,
    });

    if (params.authorType) {
      validateEnum(
        params.authorType,
        VALID_AUTHOR_TYPES,
        'author-type must be "user" or "bot"'
      );
    }

    if (params.has) {
      validateEnum(
        params.has,
        VALID_HAS_VALUES,
        "has must be one of: link, embed, file, video, image, sound"
      );
    }

    return searchMessagesImpl(this.client, params.guildId, {
      content: trimmedContent,
      authorIds,
      authorType: params.authorType,
      channelIds,
      has: params.has,
      limit: params.limit ?? 25,
      offset: params.offset ?? 0,
    });
  }

  private handleMessagesRecent(params: MessagesRecentParams) {
    validateLimit(params.limit ?? 50, 1, 100);

    const channelIds = params.channelIds ?? [];
    const guildId =
      params.guildId ?? resolveGuildFromCache(this.client.guilds.cache);

    return recentMessagesImpl(this.client, guildId, {
      channelIds,
      limit: params.limit ?? 50,
    });
  }

  private handleGuildResolve(params: GuildResolveParams) {
    // If channelId is provided, resolve via channel's guild
    if (params.channelId) {
      const channel = this.client.channels.cache.get(params.channelId);
      if (channel && "guildId" in channel && channel.guildId) {
        return { guildId: channel.guildId };
      }
      throw new Error(`Cannot resolve guild for channel ${params.channelId}`);
    }

    return { guildId: resolveGuildFromCache(this.client.guilds.cache) };
  }

  private handleChannelsList(_params: ChannelsListParams) {
    const channels: ChannelInfo[] = [];

    for (const guild of this.client.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (!TEXT_CHANNEL_TYPES.has(channel.type)) {
          continue;
        }
        const pos = "position" in channel ? (channel.position as number) : null;
        channels.push(toChannelInfo(guild, channel, pos));
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
  }
}
