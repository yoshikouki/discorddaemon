# Design: IPC-Based Connection Architecture (v2)

## 1. Problem Statement

Every CLI command in ddd v1 creates a throwaway Discord gateway connection. This works, but it is wasteful:

```
ddd messages list <ch>     # login → gateway ready (3-4s) → fetch → destroy
ddd messages send <ch>     # login → gateway ready (3-4s) → send → destroy
ddd channels               # login → gateway ready (3-4s) → list → destroy
```

Each invocation pays the full gateway handshake cost: TCP connect, WebSocket upgrade, IDENTIFY, READY event. For a single command this is tolerable. For compound workflows it is not:

- **`messages recent`** creates two connections: one for guild resolution (`defaultGuildResolver` calls `withDiscordClient`), then another for the actual search (`defaultRecentExecutor` calls `withDiscordClient`). Both could share the same client.
- **Agent workflows** chain commands: `recent` then `send` then `react`. Three separate gateway connections, 9-12 seconds of overhead, three IDENTIFY events hitting Discord's rate limit budget.
- **The daemon already has a persistent connection.** It maintains a logged-in `Client` for the lifetime of the process. CLI commands ignore it entirely.

The v2 architecture lets CLI commands talk to the running daemon over a Unix domain socket, reusing its persistent Discord client. When no daemon is running, commands fall back to the current one-shot behavior.

---

## 2. Design Principles

1. **Transport agnostic.** Command signatures (`listMessages`, `sendMessage`, etc.) do not change. The executor DI pattern already isolates transport from business logic — IPC is just another executor.

2. **Graceful degradation.** CLI works with or without a running daemon. If the daemon is not running, commands fall back to one-shot mode. No user action required.

3. **Zero new dependencies.** Bun provides `Bun.listen` (Unix socket server) and `Bun.connect` (Unix socket client) natively. No external libraries.

4. **Executor pattern reuse.** The existing DI pattern in `src/commands/messages.ts` (e.g., `executor: MessageListExecutor = defaultListExecutor`) is the migration path. Hybrid executors slot in as new defaults.

5. **Incremental adoption.** Commands can be migrated one at a time. A half-migrated codebase is valid — some commands use IPC, others still use one-shot.

---

## 3. Architecture

### 3.1 Connection Modes

Three modes, selected automatically per invocation:

```
Mode 1: IPC (daemon running)

  CLI ──unix socket──▶ daemon ──gateway──▶ Discord
                         │
                    persistent Client
                    (already logged in)


Mode 2: One-shot (daemon not running)

  CLI ──gateway──▶ Discord
         │
    throwaway Client
    (login, action, destroy)


Mode 3: REST-only (future, no gateway needed)

  CLI ──HTTP──▶ Discord REST API
                (no gateway connection at all)
```

Mode 1 is the fast path: no gateway handshake, sub-millisecond IPC latency. Mode 2 is the current behavior, kept as fallback. Mode 3 is out of scope for v2 but the architecture does not preclude it.

### 3.2 IPC Protocol

**Transport:** Unix domain socket at a well-known path.

```typescript
// src/paths.ts (new export)
export const SOCKET_PATH = join(DATA_DIR, "daemon.sock");
```

This places the socket alongside the PID file (`~/.local/share/ddd/daemon.sock`), following XDG conventions.

**Format:** NDJSON — one JSON object per line, matching the CLI output convention. Each message is newline-delimited, parsed with a simple line buffer.

**Request shape:**

```typescript
interface IpcRequest {
  id: string;          // Client-generated unique ID (for matching response)
  method: string;      // Mirrors CLI subcommands
  params: unknown;     // Method-specific parameters
}
```

**Response shape:**

```typescript
interface IpcResponse {
  id: string;          // Echoes request ID
  result?: unknown;    // Success payload
  error?: string;      // Error message (mutually exclusive with result)
}
```

This is deliberately simpler than JSON-RPC. No version field, no error codes, no batching. The protocol is internal to ddd — not a public API.

**Example exchange:**

```
→ {"id":"a1","method":"messages/list","params":{"channelId":"123","limit":50}}
← {"id":"a1","result":[{"id":"msg1","content":"hello",...}]}

→ {"id":"a2","method":"messages/send","params":{"channelId":"123","content":"hi"}}
← {"id":"a2","result":{"id":"msg2","content":"hi",...}}

→ {"id":"a3","method":"messages/delete","params":{"channelId":"123","messageId":"msg2"}}
← {"id":"a3","result":null}

→ {"id":"a4","method":"daemon/ping","params":{}}
← {"id":"a4","result":{"uptime":3600,"pid":12345}}

→ {"id":"a5","method":"daemon/info","params":{}}
← {"id":"a5","result":{"uptime":3600,"pid":12345,"tokenFingerprint":"a1b2c3d4"}}

→ {"id":"a6","method":"messages/list","params":{"channelId":"invalid"}}
← {"id":"a6","error":"Channel invalid is not a text channel"}
```

**Methods:**

| Method | Params | Result |
|--------|--------|--------|
| `daemon/ping` | `{}` | `{ uptime: number, pid: number }` |
| `daemon/info` | `{}` | `{ uptime: number, pid: number, tokenFingerprint: string }` |
| `guild/resolve` | `{ channelId?: string }` | `{ guildId: string }` |
| `channels/list` | `{ token?: string }` | `ChannelInfo[]` |
| `messages/list` | `{ channelId, limit, before?, after?, around? }` | `MessageInfo[]` |
| `messages/send` | `{ channelId, content }` | `MessageInfo` |
| `messages/edit` | `{ channelId, messageId, content }` | `MessageInfo` |
| `messages/delete` | `{ channelId, messageId }` | `null` |
| `messages/react` | `{ channelId, messageId, emoji }` | `null` |
| `messages/search` | `{ guildId, content?, authorIds, ... }` | `MessageInfo[]` |
| `messages/recent` | `{ guildId?, channelIds, limit }` | `MessageInfo[]` |

Note: `token` is not included in most params. The daemon already has a token from its config. The exception is `channels/list`, which accepts an optional token override to match the CLI's `--token` flag behavior.

### 3.3 Daemon IPC Server

The IPC server is added to the existing `Daemon` class. It listens on the Unix socket alongside the gateway event loop.

```typescript
// src/ipc/server.ts

import { existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Server, Socket } from "bun";
import type { Client } from "discord.js";
import { SOCKET_PATH } from "../paths";
import type { IpcRequest, IpcResponse } from "./protocol";

export class IpcServer {
  private server: Server | null = null;
  private readonly client: Client<true>;
  private readonly startTime: number;
  private readonly tokenFingerprint: string;
  private buffers = new Map<Socket, string>();

  constructor(client: Client<true>, token: string) {
    this.client = client;
    this.startTime = Date.now();
    // First 8 chars of SHA-256 hash — used by probe for token verification
    const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
    this.tokenFingerprint = hash.slice(0, 8);
  }

  async start(): Promise<void> {
    // Ensure ~/.ddd/ directory exists with mode 0700
    const socketDir = dirname(SOCKET_PATH);
    mkdirSync(socketDir, { recursive: true, mode: 0o700 });

    // If socket path exists, verify it is actually a socket before removing
    if (existsSync(SOCKET_PATH)) {
      const stat = lstatSync(SOCKET_PATH);
      if (!stat.isSocket()) {
        throw new Error(
          `${SOCKET_PATH} exists but is not a socket — refusing to overwrite`,
        );
      }
      // Check if another daemon is listening (socket is live, not stale)
      const alive = await this.isSocketConnectable();
      if (alive) {
        throw new Error(
          `Another daemon is already listening on ${SOCKET_PATH} — refusing to start`,
        );
      }
      // Stale socket from a crashed daemon — safe to remove
      unlinkSync(SOCKET_PATH);
    }

    this.server = Bun.listen({
      unix: SOCKET_PATH,
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

    console.error(`[ddd] IPC server listening on ${SOCKET_PATH}`);
  }

  /**
   * Socket security relies on filesystem permissions of `~/.ddd/` directory
   * (mode 0700). Only the owning user can connect.
   */
  private isSocketConnectable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 500);
      Bun.connect({
        unix: SOCKET_PATH,
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
          data() {},
          close() {},
        },
      });
    });
  }

  stop(): void {
    this.server?.stop();
    this.buffers.clear();
    // Clean up socket file
    try {
      unlinkSync(SOCKET_PATH);
    } catch {
      // best-effort
    }
  }

  private handleData(socket: Socket, data: Buffer): void {
    const existing = this.buffers.get(socket) ?? "";
    const combined = existing + data.toString();
    const parts = combined.split("\n");
    this.buffers.set(socket, parts.pop() ?? ""); // keep incomplete line

    for (const line of parts) {
      if (!line.trim()) continue;
      this.handleLine(socket, line);
    }
  }

  private handleClose(socket: Socket): void {
    this.buffers.delete(socket);
  }

  private async handleLine(socket: any, line: string): Promise<void> {
    let request: IpcRequest;
    try {
      request = JSON.parse(line);
    } catch {
      const response: IpcResponse = { id: "", error: "Invalid JSON" };
      socket.write(JSON.stringify(response) + "\n");
      return;
    }

    try {
      const result = await this.dispatch(request);
      const response: IpcResponse = { id: request.id, result };
      socket.write(JSON.stringify(response) + "\n");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const response: IpcResponse = { id: request.id, error: message };
      socket.write(JSON.stringify(response) + "\n");
    }
  }

  private async dispatch(request: IpcRequest): Promise<unknown> {
    switch (request.method) {
      case "daemon/ping":
        return {
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          pid: process.pid,
        };

      case "daemon/info":
        return {
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          pid: process.pid,
          tokenFingerprint: this.tokenFingerprint,
        };

      case "messages/list":
        return this.handleMessagesList(request.params);

      case "messages/send":
        return this.handleMessagesSend(request.params);

      // ... other methods follow the same pattern

      default:
        throw new Error(`Unknown method: ${request.method}`);
    }
  }

  private async handleMessagesList(params: any): Promise<unknown> {
    const { channelId, limit, before, after, around } = params;
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a text channel`);
    }
    const fetchOpts: Record<string, unknown> = { limit };
    if (before) fetchOpts.before = before;
    if (after) fetchOpts.after = after;
    if (around) fetchOpts.around = around;
    const messages = await channel.messages.fetch(fetchOpts);
    return [...messages.values()].map(buildMessageInfo);
  }

  private async handleMessagesSend(params: any): Promise<unknown> {
    const { channelId, content } = params;
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.isSendable()) {
      throw new Error(`Channel ${channelId} is not a sendable text channel`);
    }
    const message = await channel.send({ content });
    return buildMessageInfo(message);
  }
}
```

**Parameter validation principle:** IPC is an input boundary. All handlers MUST validate params independently of CLI-side validation. Validation logic from existing command functions (e.g., limit range checks, mutually exclusive flags like `before`/`after`/`around`) should be extracted into shared validators and reused in both CLI commands and IPC handlers. The principle is: **validate at every boundary** — CLI validates for user feedback, daemon validates for safety.

**Integration with Daemon class** (`src/daemon.ts`):

```typescript
export class Daemon {
  private ipcServer: IpcServer | null = null;
  // ... existing fields ...

  async start(): Promise<void> {
    this.client.once(Events.ClientReady, (c) => {
      log(`Logged in as ${c.user.tag}`);
      log(`Watching ${this.config.channels.size} channel(s)`);

      // Start IPC server after gateway is ready
      this.ipcServer = new IpcServer(c, this.config.token);
      await this.ipcServer.start();
    });

    // ... existing event handlers ...
    await this.client.login(this.config.token);
  }

  stop(): void {
    log("Shutting down...");
    this.ipcServer?.stop();      // Stop IPC server first
    this.abortController.abort();
    this.client.destroy();
    log("Stopped");
  }
}
```

The IPC server starts only after `ClientReady` fires, guaranteeing that the `client` passed to `IpcServer` is fully authenticated.

**Socket startup safety:** Before binding, the server checks any existing socket path with `lstat` to ensure it is actually a socket (not a regular file). It then attempts to connect — if the connection succeeds, another daemon is already running and the server refuses to start. Only a stale, non-connectable socket is removed. The `~/.ddd/` directory is created with mode `0700`, restricting access to the owning user.

**Socket security:** Socket security relies on filesystem permissions of the `~/.ddd/` directory (mode `0700`). Only the owning user can connect to or observe the socket. No authentication token is exchanged over the socket itself — the daemon trusts any connection that reaches the socket file.

### 3.4 IPC Client

The client is a thin wrapper around `Bun.connect` that sends a request and waits for the matching response.

```typescript
// src/ipc/client.ts

import { SOCKET_PATH } from "../paths";
import type { IpcRequest, IpcResponse } from "./protocol";

const IPC_TIMEOUT_MS = 30_000; // 30s default, covers slow Discord API calls

export class IpcClient {
  async call<T>(method: string, params: unknown): Promise<T> {
    const id = crypto.randomUUID();
    const request: IpcRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`IPC timeout after ${IPC_TIMEOUT_MS}ms`));
      }, IPC_TIMEOUT_MS);

      let buffer = "";
      let settled = false;

      Bun.connect({
        unix: SOCKET_PATH,
        socket: {
          open(socket) {
            socket.write(JSON.stringify(request) + "\n");
          },
          data(_socket, data) {
            buffer += data.toString();
            const parts = buffer.split("\n");
            buffer = parts.pop() ?? ""; // keep incomplete trailing segment

            for (const line of parts) {
              if (!line.trim() || settled) continue;
              try {
                const response: IpcResponse = JSON.parse(line);
                if (response.id !== id) continue;
                settled = true;
                clearTimeout(timeout);
                if (response.error) {
                  reject(new Error(response.error));
                } else {
                  resolve(response.result as T);
                }
                _socket.end();
              } catch {
                // shouldn't happen with proper line buffering
              }
            }
          },
          error(_socket, error) {
            if (!settled) {
              clearTimeout(timeout);
              reject(error);
            }
          },
          close() {
            if (!settled) {
              clearTimeout(timeout);
            }
          },
        },
      });
    });
  }
}
```

### 3.5 Hybrid Executor Pattern

The existing DI pattern evolves in three steps:

```
v1 (current):

  listMessages(..., executor = defaultListExecutor)
                                    │
                            withDiscordClient → Discord


v2 (target):

  listMessages(..., executor = hybridListExecutor)
                                    │
                         ┌──────────┴──────────┐
                    try IPC client          fallback
                         │                     │
                    daemon socket      withDiscordClient → Discord
```

**Implementation:**

```typescript
// src/ipc/executors.ts

import { IpcClient } from "./client";
import { probeDaemon, ConnectionRefusedError } from "./probe";
import type { MessageInfo } from "../message-info";

// --- IPC executors (talk to daemon) ---

function ipcListExecutor(
  _token: string,  // unused — daemon has its own token
  channelId: string,
  options: { limit: number; before?: string; after?: string; around?: string },
): Promise<MessageInfo[]> {
  const client = new IpcClient();
  return client.call("messages/list", { channelId, ...options });
}

function ipcSendExecutor(
  _token: string,
  channelId: string,
  content: string,
): Promise<MessageInfo> {
  const client = new IpcClient();
  return client.call("messages/send", { channelId, content });
}

function ipcEditExecutor(
  _token: string,
  channelId: string,
  messageId: string,
  content: string,
): Promise<MessageInfo> {
  const client = new IpcClient();
  return client.call("messages/edit", { channelId, messageId, content });
}

function ipcDeleteExecutor(
  _token: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  const client = new IpcClient();
  return client.call("messages/delete", { channelId, messageId });
}

function ipcReactExecutor(
  _token: string,
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const client = new IpcClient();
  return client.call("messages/react", { channelId, messageId, emoji });
}

function ipcSearchExecutor(
  _token: string,
  guildId: string,
  options: {
    content?: string;
    authorIds: string[];
    authorType?: string;
    channelIds: string[];
    has?: string;
    limit: number;
    offset: number;
  },
): Promise<MessageInfo[]> {
  const client = new IpcClient();
  return client.call("messages/search", { guildId, ...options });
}

function ipcRecentExecutor(
  _token: string,
  guildId: string | undefined,
  options: { channelIds: string[]; limit: number },
): Promise<MessageInfo[]> {
  const client = new IpcClient();
  // When guildId is undefined, the daemon resolves it internally
  // using client.guilds.cache — no extra connection needed.
  return client.call("messages/recent", { guildId, ...options });
}

// --- Hybrid executors (try IPC, fall back to one-shot) ---

/**
 * Creates a hybrid executor that tries IPC first and falls back to one-shot.
 *
 * IMPORTANT: Fallback safety depends on whether the request was transmitted.
 * - ConnectionRefusedError / socket-not-found → request never sent → safe to fallback
 * - Timeout AFTER request sent / broken pipe during response → NOT safe to fallback
 *   for side-effect commands (send, edit, delete, react) because the daemon may
 *   have already executed the action.
 *
 * Read-only commands (list, search, recent) are always safe to retry.
 * Side-effect commands only fall back on connection-phase failures.
 */
export function createHybridExecutor<Args extends unknown[], T>(
  ipcExecutor: (...args: Args) => Promise<T>,
  oneshotExecutor: (...args: Args) => Promise<T>,
  options: { safeToRetry: boolean } = { safeToRetry: true },
): (...args: Args) => Promise<T> {
  return async (...args: Args): Promise<T> => {
    const probe = await probeDaemon();
    if (!probe.available) {
      return oneshotExecutor(...args);
    }

    try {
      return await ipcExecutor(...args);
    } catch (err) {
      if (err instanceof ConnectionRefusedError) {
        // Request never sent — safe to fallback for any command
        return oneshotExecutor(...args);
      }
      if (options.safeToRetry) {
        // Read-only command — safe to fallback regardless of failure mode
        return oneshotExecutor(...args);
      }
      // Side-effect command and request may have been sent — NOT safe to retry.
      // Re-throw so the caller sees the error instead of risking double-execution.
      throw err;
    }
  };
}

// Pre-built hybrid executors, ready to use as defaults.
// Read-only commands: safeToRetry = true (default) — fallback on any IPC error.
// Side-effect commands: safeToRetry = false — only fallback on connection-phase failures.
export const hybridListExecutor = createHybridExecutor(
  ipcListExecutor, defaultListExecutor,
);
export const hybridSendExecutor = createHybridExecutor(
  ipcSendExecutor, defaultSendExecutor,
  { safeToRetry: false },
);
export const hybridEditExecutor = createHybridExecutor(
  ipcEditExecutor, defaultEditExecutor,
  { safeToRetry: false },
);
export const hybridDeleteExecutor = createHybridExecutor(
  ipcDeleteExecutor, defaultDeleteExecutor,
  { safeToRetry: false },
);
export const hybridReactExecutor = createHybridExecutor(
  ipcReactExecutor, defaultReactExecutor,
  { safeToRetry: false },
);
export const hybridSearchExecutor = createHybridExecutor(
  ipcSearchExecutor, defaultSearchExecutor,
);
export const hybridRecentExecutor = createHybridExecutor(
  ipcRecentExecutor, defaultRecentExecutor,
);
```

### 3.6 Client Probe Logic

The CLI must decide quickly whether to use IPC or fall back. The probe is a four-step check:

```typescript
// src/ipc/probe.ts

import { existsSync } from "node:fs";
import { SOCKET_PATH } from "../paths";
import { isProcessRunning, readPid } from "../pid";

const PROBE_TIMEOUT_MS = 500;

interface ProbeResult {
  available: boolean;
  socketPath: string;
}

export async function probeDaemon(cliToken?: string): Promise<ProbeResult> {
  const unavailable = { available: false, socketPath: SOCKET_PATH };

  // Step 1: PID file exists and process is alive?
  const pid = await readPid();
  if (pid === null || !isProcessRunning(pid)) {
    return unavailable;
  }

  // Step 2: Socket file exists?
  if (!existsSync(SOCKET_PATH)) {
    return unavailable;
  }

  // Step 3: Can we actually connect? (guards against stale socket)
  try {
    const reachable = await probeSocket();
    if (!reachable) return unavailable;
  } catch {
    return unavailable;
  }

  // Step 4: Token verification via daemon/info
  if (cliToken) {
    try {
      const client = new IpcClient();
      const info = await client.call<DaemonInfoResult>("daemon/info", {});
      const hash = new Bun.CryptoHasher("sha256").update(cliToken).digest("hex");
      const cliFingerprint = hash.slice(0, 8);
      if (info.tokenFingerprint !== cliFingerprint) {
        console.error(
          "[ddd] Token mismatch: daemon uses a different bot token — falling back to one-shot",
        );
        return unavailable;
      }
    } catch {
      // If daemon/info fails, proceed without token check (forward compat)
    }
  }

  return { available: true, socketPath: SOCKET_PATH };
}

// Backward-compatible wrapper
export async function isDaemonReachable(): Promise<boolean> {
  const result = await probeDaemon();
  return result.available;
}

function probeSocket(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);

    Bun.connect({
      unix: SOCKET_PATH,
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
        data() {},
        close() {},
      },
    });
  });
}
```

**Why four steps, not just connect?**

- Step 1 (PID check) is a filesystem read — effectively free. It catches the common case of "no daemon" without attempting a socket connection at all.
- Step 2 (socket file check) catches the case where the daemon is running but the IPC server hasn't started yet (between process start and `ClientReady`).
- Step 3 (actual connect) catches stale socket files from crashed daemons.
- Step 4 (token verification) ensures the CLI and daemon are using the same bot token, preventing silent misuse of the wrong token.

The probe is designed to fail fast. Steps 1-3 complete in microseconds. Step 4 adds one IPC round-trip (sub-millisecond on a local Unix socket). If any step takes longer than 500ms, something is wrong.

**Token verification:** After confirming the daemon is reachable, the probe sends a `daemon/info` request to retrieve the daemon's token fingerprint (first 8 characters of the SHA-256 hash of the bot token). The CLI computes the same hash from its resolved token. If the fingerprints don't match, the probe logs a warning (`[ddd] Token mismatch: daemon uses a different bot token — falling back to one-shot`) and returns `available: false`, forcing a one-shot fallback. This prevents silently using the wrong bot token.

v2 uses a single-token model. `daemon/info` returns a token fingerprint (truncated hash) for verification. Multi-token support is deferred to v3.

**Caching:** The probe result is not cached. Each command invocation probes independently. This is correct because the daemon could start or stop between invocations. The overhead is negligible (one PID file read + one filesystem stat + one sub-millisecond socket connect + one `daemon/info` call).

---

## 4. v2 Scope (implement now)

### 4.1 Protocol types

```typescript
// src/ipc/protocol.ts

export interface IpcRequest {
  id: string;
  method: string;
  params: unknown;
}

export interface IpcResponse {
  id: string;
  result?: unknown;
  error?: string;
}

// Method parameter types (used by both server and client)

export interface PingParams {}
export interface PingResult {
  uptime: number;
  pid: number;
}

export interface DaemonInfoParams {}
export interface DaemonInfoResult {
  uptime: number;
  pid: number;
  tokenFingerprint: string;  // first 8 chars of SHA-256(token)
}

export interface GuildResolveParams {
  channelId?: string;
}
export interface GuildResolveResult {
  guildId: string;
}

export interface MessagesListParams {
  channelId: string;
  limit: number;
  before?: string;
  after?: string;
  around?: string;
}

export interface MessagesSendParams {
  channelId: string;
  content: string;
}

export interface MessagesEditParams {
  channelId: string;
  messageId: string;
  content: string;
}

export interface MessagesDeleteParams {
  channelId: string;
  messageId: string;
}

export interface MessagesReactParams {
  channelId: string;
  messageId: string;
  emoji: string;
}

export interface MessagesSearchParams {
  guildId: string;
  content?: string;
  authorIds: string[];
  authorType?: string;
  channelIds: string[];
  has?: string;
  limit: number;
  offset: number;
}

export interface MessagesRecentParams {
  guildId?: string;
  channelIds: string[];
  limit: number;
}

export interface ChannelsListParams {
  token?: string;
}
```

### 4.2 IPC server in daemon

- `IpcServer` class: listens on Unix socket, dispatches requests to handler methods using the daemon's authenticated `Client`
- Integrated into `Daemon.start()` (after `ClientReady`) and `Daemon.stop()`
- Socket startup safety: `lstat` check (must be socket), live-socket detection (refuse if another daemon is listening), `~/.ddd/` directory mode `0700`
- Socket cleanup on start (stale file only) and stop
- Per-socket line buffering with `Map<Socket, string>` and cleanup on socket close
- Handler methods reuse the same logic as `defaultXxxExecutor` functions, but operate on the daemon's persistent client instead of a throwaway one
- All handlers validate params independently (IPC is an input boundary)

### 4.3 IPC client in CLI

- `IpcClient` class: connects to Unix socket, sends NDJSON request, waits for matching response
- 30-second timeout per request (Discord API calls can be slow under rate limits)
- Single request per connection (connect, send, receive, close)

### 4.4 Probe logic

- `probeDaemon(cliToken?)`: PID check → socket file check → connect probe (500ms timeout) → token fingerprint verification via `daemon/info`
- Returns `{ available: boolean, socketPath: string }`
- `isDaemonReachable()` wrapper retained for backward compatibility
- Used by hybrid executors to decide IPC vs one-shot

### 4.5 Hybrid executors for all commands

Replace default executors in `src/commands/messages.ts`:

| Command | Current default | New default |
|---------|----------------|-------------|
| `messages list` | `defaultListExecutor` | `hybridListExecutor` |
| `messages send` | `defaultSendExecutor` | `hybridSendExecutor` |
| `messages edit` | `defaultEditExecutor` | `hybridEditExecutor` |
| `messages delete` | `defaultDeleteExecutor` | `hybridDeleteExecutor` |
| `messages react` | `defaultReactExecutor` | `hybridReactExecutor` |
| `messages search` | `defaultSearchExecutor` | `hybridSearchExecutor` |
| `messages recent` | `defaultRecentExecutor` | `hybridRecentExecutor` |
| `channels` | `fetchDiscordChannels` | `hybridChannelsFetcher` |

### 4.6 `recent` double-connection fix

The `recent` command currently creates two gateway connections: one for guild resolution (`defaultGuildResolver`) and one for the search itself (`defaultRecentExecutor`). With IPC, both requests go through the same daemon socket.

**Design:** The `messages/recent` IPC handler accepts an optional `guildId`. When omitted, the daemon handler resolves the guild internally using its cached `client.guilds.cache` — no extra connection, no extra IPC call. This eliminates the double-connection problem at the protocol level.

The `GuildResolverFn` must also be hybrid-ized to handle the non-IPC fallback path correctly:

- In IPC mode, guild resolution is part of the `messages/recent` handler on the daemon side. The `MessageRecentExecutor` signature changes to accept `guildId?: string`. When `guildId` is undefined, the daemon resolves it internally.
- In one-shot mode, the existing `defaultGuildResolver` still creates its own connection.
- A standalone `guild/resolve` IPC method is also provided for other use cases (e.g., future commands that need guild context without a `recent` query).

### 4.7 `daemon/ping` health check

A trivial method for verifying daemon health. Returns uptime and PID. Useful for:

- `ddd status` — can probe IPC instead of just checking PID
- Agent health checks before starting a batch of commands
- Integration tests

### 4.8 Tests

- **Protocol tests**: `IpcRequest`/`IpcResponse` serialization roundtrip
- **Probe tests**: `probeDaemon` with mocked PID file, socket, and token verification
- **IPC server + client integration**: Real Unix socket, mock Discord client
- **Hybrid executor tests**: Verify IPC path (daemon running), fallback path (daemon not running), side-effect safety (no fallback after request sent)
- **Timeout tests**: Client timeout when server hangs
- **Line buffering tests**: Partial reads, multiple messages in one buffer, per-socket buffer cleanup
- **Socket security tests**: Stale socket cleanup, live socket detection, non-socket file rejection
- **Token mismatch tests**: Fallback to one-shot on fingerprint mismatch
- **Guild resolution tests**: `recent` without `guildId` creates exactly 1 IPC call

---

## 5. Future Directions (v3+)

The following are potential extensions. They are out of scope for v2 but the architecture does not preclude them.

- **Multi-token:** The daemon manages a `Map<string, Client>` — one authenticated client per token. Requests include a `token` param to select which client handles them. This extends the `channels/list` pattern that already accepts an optional token.
- **HTTP transport:** Wrap NDJSON over HTTP POST for remote daemons. The `IpcClient` interface gains an `HttpClient` sibling, selected by config.
- **Streaming responses / event subscription:** For large result sets or real-time message watching (`ddd messages watch <channel_id>`). Requires extending the response envelope.
- **REST-only mode:** For commands that don't need the gateway (e.g., `send`, `edit`, `delete`), bypass the gateway entirely and call the Discord REST API directly.

The v2 response envelope uses `{ result } | { error }`. Future versions may add a `type` field (`"result" | "error" | "event"`) for extensibility, but this is not part of v2.

---

## 6. File Structure

### New files

```
src/
  ipc/
    server.ts          # IpcServer class — added to daemon
    client.ts          # IpcClient class — used by CLI hybrid executors
    protocol.ts        # IpcRequest, IpcResponse, and all method param/result types
    probe.ts           # probeDaemon() / isDaemonReachable() — daemon liveness + token check
    executors.ts       # ipcXxxExecutor + hybridXxxExecutor + createHybridExecutor
    server.test.ts     # IPC server unit tests
    client.test.ts     # IPC client unit tests
    probe.test.ts      # Probe logic tests
    executors.test.ts  # Hybrid executor fallback tests
    integration.test.ts # Full IPC round-trip tests
```

### Modified files

```
src/
  paths.ts             # Add SOCKET_PATH export
  daemon.ts            # Import IpcServer, start/stop in lifecycle
  commands/
    messages.ts        # Change default executors to hybrid versions
    channels.ts        # Change default fetcher to hybrid version
```

### Unchanged files

```
src/
  discord.ts           # withDiscordClient stays as fallback transport
  config.ts            # No changes
  types.ts             # No changes
  hook.ts              # No changes
  pid.ts               # No changes (reused by probe)
  message-info.ts      # No changes (reused by IPC server handlers)
  index.ts             # No changes (commands already use DI)
  commands/
    start.ts           # Minor: daemon now starts IPC server (via Daemon class)
    stop.ts            # Minor: daemon now stops IPC server (via Daemon class)
    init.ts            # No changes
    status.ts          # Potential: could use daemon/ping for richer status
```

---

## 7. Migration Strategy

Each command migrates from one-shot to hybrid in four steps:

### Step 1: Extract shared logic

The `defaultXxxExecutor` functions in `src/commands/messages.ts` contain two concerns:

1. Gateway connection management (`withDiscordClient`)
2. Business logic (fetch channel, call SDK, transform result)

The business logic is already clean — `fetchTextChannel`, `buildMessageInfo`, etc. The IPC server handlers need the same logic but with the daemon's persistent client. Factor out a shared `xxxImpl(client, params)` function:

```typescript
// Before (in messages.ts)
function defaultListExecutor(token, channelId, options) {
  return withDiscordClient(token, intents, async (client) => {
    const channel = await fetchTextChannel(client, channelId);
    const messages = await channel.messages.fetch(fetchOpts);
    return [...messages.values()].map(buildMessageInfo);
  });
}

// After (shared impl)
async function listMessagesImpl(
  client: Client<true>,
  channelId: string,
  options: { limit: number; before?: string; after?: string; around?: string },
): Promise<MessageInfo[]> {
  const channel = await fetchTextChannel(client, channelId);
  const fetchOpts: Record<string, unknown> = { limit: options.limit };
  if (options.before) fetchOpts.before = options.before;
  if (options.after) fetchOpts.after = options.after;
  if (options.around) fetchOpts.around = options.around;
  const messages = await channel.messages.fetch(fetchOpts);
  return [...messages.values()].map(buildMessageInfo);
}

// defaultListExecutor becomes:
function defaultListExecutor(token, channelId, options) {
  return withDiscordClient(token, intents, (client) =>
    listMessagesImpl(client, channelId, options)
  );
}
```

### Step 2: Create IPC executor

```typescript
function ipcListExecutor(token, channelId, options) {
  const client = new IpcClient();
  return client.call("messages/list", { channelId, ...options });
}
```

### Step 3: Create hybrid executor

```typescript
const hybridListExecutor = createHybridExecutor(
  ipcListExecutor, defaultListExecutor,
);
```

### Step 4: Swap the default

```typescript
// In listMessages():
export async function listMessages(
  args: { ... },
  executor: MessageListExecutor = hybridListExecutor,  // was defaultListExecutor
): Promise<void> {
```

### Migration order

1. **`daemon/ping`** — simplest method, validates the entire IPC stack end-to-end
2. **`messages/send`** — most immediately useful, agents send frequently
3. **`messages/list`** — pairs with send for verify-after-send pattern
4. **`messages/edit`** — structurally identical to send
5. **`messages/delete`** — simplest (void return)
6. **`messages/react`** — simplest (void return)
7. **`messages/search`** — REST-based, exercises raw API forwarding
8. **`messages/recent`** — compound command, validates guild resolution via IPC
9. **`channels/list`** — different DI pattern (ChannelFetcher), validates cross-command migration

---

## 8. Error Handling

| Condition | IPC mode | One-shot mode |
|-----------|----------|---------------|
| Daemon not running | Fallback to one-shot (transparent) | Direct execution (no change) |
| Socket connection refused | Fallback to one-shot (transparent) | N/A |
| Socket connection timeout (>500ms probe) | Fallback to one-shot (transparent) | N/A |
| IPC request timeout (>30s) | Error propagated to CLI (stderr + exit 1) | N/A |
| Invalid JSON from server | Error propagated to CLI (stderr + exit 1) | N/A |
| Discord API error (e.g., missing permissions) | Error string sent in `IpcResponse.error`, propagated to CLI (stderr + exit 1) | Error thrown by discord.js, caught in command function (stderr + exit 1) |
| Channel not found / not text-based | Error string in response, propagated | Error thrown in `fetchTextChannel`, caught in command function |
| Daemon crashes mid-request | Socket close triggers client error — see transport failure table below | N/A |
| Rate limit hit | Discord.js handles internally in daemon, response delayed | Discord.js handles internally in `withDiscordClient` |
| Invalid method name | `Unknown method: xxx` error in response | N/A |
| Malformed request params | Server-side validation error in response | N/A |
| Multiple concurrent IPC requests | Each gets own connection + ID — no interference | N/A |
| Token mismatch (daemon vs CLI) | Probe detects mismatch via `daemon/info` fingerprint — fallback to one-shot with warning | N/A |

**Error transparency principle:** The error messages visible to the CLI user should be the same regardless of transport. A `Channel 123 is not a text channel` error looks identical whether it came via IPC or one-shot. The hybrid executor swallows transport-level errors (connection refused, timeout) and retries via one-shot, but application-level errors (bad channel ID, missing permissions) propagate unchanged.

**Token verification:** If the daemon's token fingerprint (from `daemon/info`) does not match the CLI's resolved token, the probe returns `available: false` and the CLI falls back to one-shot. This is logged as a warning but is not an error — the user may intentionally run a daemon with a different token.

### Transport failure timing and fallback safety

The critical distinction is **whether the IPC request was transmitted to the daemon before the failure occurred**. This determines whether fallback to one-shot is safe.

| Failure mode | Request sent? | Read commands (list, search, recent) | Write commands (send, edit, delete, react) |
|---|---|---|---|
| Socket not found / connection refused | No | Fallback to one-shot | Fallback to one-shot |
| Connection timeout (probe phase, <500ms) | No | Fallback to one-shot | Fallback to one-shot |
| Timeout AFTER request written (>30s) | Yes | Fallback to one-shot (idempotent) | **Error — do NOT fallback** (action may have executed) |
| Broken pipe during response read | Yes | Fallback to one-shot (idempotent) | **Error — do NOT fallback** (action may have executed) |
| Server returns error JSON | Yes (and processed) | Propagate error | Propagate error |

For side-effect commands, re-executing after a "request sent, response lost" failure could result in duplicate messages, double-deletes, or duplicate reactions. The hybrid executor distinguishes these cases using `ConnectionRefusedError` (request never sent) vs other errors (request may have been sent). See section 3.5 for the implementation.

---

## 9. Testing Strategy

### 9.1 Unit tests

**Protocol serialization** (`src/ipc/protocol.test.ts`):
- Roundtrip: `IpcRequest` → JSON string → parse → equal
- Roundtrip: `IpcResponse` with result → JSON string → parse → equal
- Roundtrip: `IpcResponse` with error → JSON string → parse → equal
- Edge cases: empty params, null result, unicode content

**Client probe logic** (`src/ipc/probe.test.ts`):
- No PID file → returns false
- PID file exists, process dead → returns false
- PID file exists, process alive, no socket → returns false
- PID file exists, process alive, socket exists → returns true (with mock socket)
- Socket connect timeout → returns false

### 9.2 Integration tests

**IPC round-trip** (`src/ipc/integration.test.ts`):

```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

describe("IPC round-trip", () => {
  let server: IpcServer;
  let mockClient: MockDiscordClient;

  beforeAll(async () => {
    mockClient = createMockDiscordClient();
    server = new IpcServer(mockClient as any);
    server.start();
  });

  afterAll(() => {
    server.stop();
  });

  test("daemon/ping returns uptime and pid", async () => {
    const client = new IpcClient();
    const result = await client.call<PingResult>("daemon/ping", {});
    expect(result.pid).toBe(process.pid);
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  test("messages/list returns message array", async () => {
    const client = new IpcClient();
    const result = await client.call<MessageInfo[]>("messages/list", {
      channelId: "test-channel",
      limit: 10,
    });
    expect(Array.isArray(result)).toBe(true);
  });

  test("unknown method returns error", async () => {
    const client = new IpcClient();
    await expect(
      client.call("nonexistent/method", {})
    ).rejects.toThrow("Unknown method");
  });

  test("server error propagates to client", async () => {
    const client = new IpcClient();
    await expect(
      client.call("messages/list", { channelId: "invalid", limit: 10 })
    ).rejects.toThrow("not a text channel");
  });
});
```

### 9.3 Hybrid executor tests

**Fallback behavior** (`src/ipc/executors.test.ts`):

```typescript
describe("createHybridExecutor", () => {
  test("uses IPC when daemon is reachable", async () => {
    const ipc = mock(() => Promise.resolve("ipc-result"));
    const oneshot = mock(() => Promise.resolve("oneshot-result"));
    const hybrid = createHybridExecutor(ipc, oneshot);

    // With daemon running:
    const result = await hybrid("token", "ch", { limit: 10 });
    expect(ipc).toHaveBeenCalled();
    expect(oneshot).not.toHaveBeenCalled();
    expect(result).toBe("ipc-result");
  });

  test("falls back to one-shot when daemon not reachable", async () => {
    const ipc = mock(() => Promise.resolve("ipc-result"));
    const oneshot = mock(() => Promise.resolve("oneshot-result"));
    const hybrid = createHybridExecutor(ipc, oneshot);

    // Without daemon:
    const result = await hybrid("token", "ch", { limit: 10 });
    expect(oneshot).toHaveBeenCalled();
    expect(result).toBe("oneshot-result");
  });

  test("falls back to one-shot when IPC call fails with ConnectionRefusedError", async () => {
    const ipc = mock(() => Promise.reject(new ConnectionRefusedError()));
    const oneshot = mock(() => Promise.resolve("oneshot-result"));
    const hybrid = createHybridExecutor(ipc, oneshot);

    // Daemon reachable but connection refused (stale probe):
    const result = await hybrid("token", "ch", { limit: 10 });
    expect(result).toBe("oneshot-result");
  });

  test("read-only: falls back to one-shot on any IPC error", async () => {
    const ipc = mock(() => Promise.reject(new Error("broken pipe")));
    const oneshot = mock(() => Promise.resolve("oneshot-result"));
    const hybrid = createHybridExecutor(ipc, oneshot, { safeToRetry: true });

    const result = await hybrid("token", "ch", { limit: 10 });
    expect(result).toBe("oneshot-result");
  });

  test("side-effect: does NOT fall back when request may have been sent", async () => {
    const ipc = mock(() => Promise.reject(new Error("broken pipe")));
    const oneshot = mock(() => Promise.resolve("oneshot-result"));
    const hybrid = createHybridExecutor(ipc, oneshot, { safeToRetry: false });

    // Should throw, not fall back — request may have been processed
    await expect(hybrid("token", "ch", "content")).rejects.toThrow("broken pipe");
    expect(oneshot).not.toHaveBeenCalled();
  });
});
```

### 9.4 Line buffering tests

Verify correct behavior when TCP delivers data in unexpected chunks:

- Full message in one `data` event
- Message split across two `data` events
- Two messages in one `data` event
- Partial JSON followed by completion in next event
- Server: per-socket buffer cleanup on socket close

### 9.5 Safety and security tests

**Side-effect safety** (`src/ipc/executors.test.ts`):
- Verify that `send` via IPC does NOT fall back to one-shot when IPC response is lost (request was sent) — the hybrid executor must throw instead of retrying
- Verify that `list` (read-only) DOES fall back to one-shot on any IPC error

**Socket permissions** (`src/ipc/server.test.ts`):
- Verify daemon refuses to start if `~/.ddd/` is world-readable (mode check)
- Verify daemon refuses to overwrite a non-socket file at the socket path

**Stale socket cleanup** (`src/ipc/server.test.ts`):
- Verify daemon cleans up stale socket (exists but not connectable)
- Verify daemon refuses to start if socket is live (another daemon is listening)

**Token mismatch** (`src/ipc/probe.test.ts`):
- Verify CLI falls back to one-shot when daemon token fingerprint doesn't match CLI token
- Verify CLI proceeds with IPC when token fingerprints match

**Guild resolution** (`src/ipc/integration.test.ts`):
- Verify `recent` without `guildId` creates exactly 1 IPC call (not 2) — guild is resolved server-side
- Verify `recent` with explicit `guildId` passes it through without server-side resolution

---

## 10. Implementation Order

Tasks are ordered by dependency. Each task produces a testable unit.

1. **`src/ipc/protocol.ts`** — Type definitions (including `ConnectionRefusedError`) and `daemon/info` types. No runtime behavior. Unblocks all other tasks.

2. **`src/paths.ts`** — Add `SOCKET_PATH` export. One line change.

3. **`src/ipc/server.ts`** — IPC server with `daemon/ping` and `daemon/info` handlers. Includes socket security (directory mode `0700`, `lstat` check, live-socket detection). Test with raw socket client.
   - Depends on: (1), (2)

4. **`src/ipc/client.ts`** — IPC client with proper line buffering (`settled` flag, buffer remainder tracking). Test against server from (3).
   - Depends on: (1), (2)

5. **`src/ipc/probe.ts`** — `probeDaemon()` with token fingerprint verification via `daemon/info`. Test with mocked PID + real socket from (3).
   - Depends on: (2), (4)

6. **`src/ipc/integration.test.ts`** — End-to-end test: server + client + ping + info. Validates the full stack before adding real handlers.
   - Depends on: (3), (4)

7. **`src/daemon.ts`** — Integrate `IpcServer` into `Daemon.start()` and `Daemon.stop()`.
   - Depends on: (3)

8. **`src/commands/start.ts`** — No code changes needed (daemon lifecycle change is in `Daemon` class). Verify socket file appears after `ddd start` and disappears after `ddd stop`. Verify duplicate daemon detection.
   - Depends on: (7)

9. **Extract shared validators** — Extract validation logic (limit range checks, mutually exclusive flags) from CLI commands into shared validators. Extract `xxxImpl` functions from `defaultXxxExecutor` to separate business logic from transport. No behavior change.
   - Depends on: nothing (pure refactor)

10. **`src/ipc/server.ts`** — Add all method handlers (`messages/list`, `messages/send`, `guild/resolve`, etc.) using `xxxImpl` functions and shared validators.
    - Depends on: (3), (9)

11. **`src/ipc/executors.ts`** — `createHybridExecutor` with `safeToRetry` option, all IPC executors, all hybrid executors (read-only vs side-effect distinction).
    - Depends on: (4), (5)

12. **`src/commands/messages.ts`** — Swap default executors to hybrid versions. Hybrid-ize `GuildResolverFn`.
    - Depends on: (11)

13. **`src/commands/channels.ts`** — Add hybrid channel fetcher.
    - Depends on: (11)

14. **`messages/recent` guild resolution** — The `messages/recent` IPC handler resolves guild internally using `client.guilds.cache`, eliminating the double-connection. `MessageRecentExecutor` accepts optional `guildId`.
    - Depends on: (10), (12)

15. **`src/commands/status.ts`** — (Optional) Enhance `ddd status` to show IPC health via `daemon/ping`.
    - Depends on: (4)

16. **Full integration test suite** — All methods, error cases, fallback scenarios, side-effect safety, socket security, token mismatch, guild resolution.
    - Depends on: all of the above
