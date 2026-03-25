// IPC protocol types for daemon ↔ CLI communication.
// Transport: NDJSON over Unix domain socket.

export interface IpcRequest {
  id: string;
  method: string;
  params: unknown;
}

export interface IpcResponse {
  error?: string;
  id: string;
  result?: unknown;
}

// Error thrown when the IPC socket cannot be reached (daemon not running, etc.)
export class ConnectionRefusedError extends Error {
  constructor(message = "Connection refused") {
    super(message);
    this.name = "ConnectionRefusedError";
  }
}

// --- Method parameter and result types ---

export type DaemonPingParams = Record<string, never>;
export interface DaemonPingResult {
  pid: number;
  uptime: number;
}

export type DaemonInfoParams = Record<string, never>;
export interface DaemonInfoResult {
  pid: number;
  tokenFingerprint: string; // first 8 chars of SHA-256(token)
  uptime: number;
}

export interface GuildResolveParams {
  channelId?: string;
}
export interface GuildResolveResult {
  guildId: string;
}

export interface MessagesListParams {
  after?: string;
  around?: string;
  before?: string;
  channelId: string;
  limit: number;
}

export interface MessagesSendParams {
  channelId: string;
  content: string;
}

export interface MessagesEditParams {
  channelId: string;
  content: string;
  messageId: string;
}

export interface MessagesDeleteParams {
  channelId: string;
  messageId: string;
}

export interface MessagesReactParams {
  channelId: string;
  emoji: string;
  messageId: string;
}

export interface MessagesSearchParams {
  authorIds: string[];
  authorType?: string;
  channelIds: string[];
  content?: string;
  guildId: string;
  has?: string;
  limit: number;
  offset: number;
}

export interface MessagesRecentParams {
  channelIds: string[];
  guildId?: string;
  limit: number;
}

export interface ChannelsListParams {
  token?: string;
}
