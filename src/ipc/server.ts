import { existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Socket } from "bun";
import type { Client } from "discord.js";
import { SOCKET_PATH } from "../paths";
import type { IpcRequest, IpcResponse } from "./protocol";

export class IpcServer {
  private server: ReturnType<typeof Bun.listen> | null = null;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used by future message handlers
  private readonly client: Client<true>;
  private readonly startTime: number;
  private readonly tokenFingerprint: string;
  private readonly socketPath: string;
  private readonly buffers = new Map<Socket<undefined>, string>();

  constructor(client: Client<true>, token: string, socketPath?: string) {
    this.client = client;
    this.startTime = Date.now();
    this.socketPath = socketPath ?? SOCKET_PATH;
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

      case "daemon/info":
        return {
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          pid: process.pid,
          tokenFingerprint: this.tokenFingerprint,
        };

      default:
        throw new Error(`Unknown method: ${request.method}`);
    }
  }
}
