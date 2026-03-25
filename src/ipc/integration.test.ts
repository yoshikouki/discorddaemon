import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "discord.js";
import { IpcClient, ipcCall } from "./client";
import type { DaemonInfoResult, DaemonPingResult } from "./protocol";
import { IpcServer } from "./server";

function createMockClient(): Client<true> {
  return {} as Client<true>;
}

function tempSocketPath(): string {
  const dir = join(
    tmpdir(),
    `ddd-ipc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return join(dir, "daemon.sock");
}

describe("IPC integration", () => {
  let server: IpcServer;
  let socketPath: string;
  const testToken = "test-bot-token-12345";

  beforeEach(async () => {
    socketPath = tempSocketPath();
    server = new IpcServer(createMockClient(), testToken, socketPath);
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  test("server starts and accepts connections", async () => {
    // Just connecting and disconnecting should work
    const connected = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 1000);
      Bun.connect({
        unix: socketPath,
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
            // intentionally empty
          },
          close() {
            // intentionally empty
          },
        },
      }).catch(() => {
        clearTimeout(timeout);
        resolve(false);
      });
    });

    expect(connected).toBe(true);
  });

  test("client can send daemon/ping and get response", async () => {
    const client = new IpcClient(socketPath);
    const result = await client.call<DaemonPingResult>("daemon/ping", {});

    expect(result).toHaveProperty("uptime");
    expect(result).toHaveProperty("pid");
    expect(typeof result.uptime).toBe("number");
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.pid).toBe(process.pid);
  });

  test("client can send daemon/info and get token fingerprint", async () => {
    const client = new IpcClient(socketPath);
    const result = await client.call<DaemonInfoResult>("daemon/info", {});

    expect(result).toHaveProperty("uptime");
    expect(result).toHaveProperty("pid");
    expect(result).toHaveProperty("tokenFingerprint");
    expect(result.tokenFingerprint).toHaveLength(8);

    // Verify fingerprint matches expected value
    const expectedFingerprint = new Bun.CryptoHasher("sha256")
      .update(testToken)
      .digest("hex")
      .slice(0, 8);
    expect(result.tokenFingerprint).toBe(expectedFingerprint);
  });

  test("unknown method returns error", async () => {
    const client = new IpcClient(socketPath);

    try {
      await client.call("nonexistent/method", {});
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("Unknown method");
    }
  });

  test("invalid JSON returns error", async () => {
    const result = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout")), 2000);
      let buffer = "";

      Bun.connect({
        unix: socketPath,
        socket: {
          open(socket) {
            socket.write("this is not json\n");
          },
          data(_socket, data) {
            buffer += data.toString();
            const parts = buffer.split("\n");
            for (const line of parts) {
              if (!line.trim()) {
                continue;
              }
              clearTimeout(timeout);
              _socket.end();
              resolve(line);
              return;
            }
          },
          error(_socket, error) {
            clearTimeout(timeout);
            reject(error);
          },
          close() {
            // intentionally empty
          },
        },
      }).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const response = JSON.parse(result);
    expect(response.error).toBe("Invalid JSON");
    expect(response.id).toBe("");
  });

  test("multiple sequential requests work", async () => {
    const client = new IpcClient(socketPath);

    const ping1 = await client.call<DaemonPingResult>("daemon/ping", {});
    expect(ping1.pid).toBe(process.pid);

    const ping2 = await client.call<DaemonPingResult>("daemon/ping", {});
    expect(ping2.pid).toBe(process.pid);

    const info = await client.call<DaemonInfoResult>("daemon/info", {});
    expect(info.tokenFingerprint).toHaveLength(8);
  });

  test("server cleanup on stop removes socket file", async () => {
    const tempPath = tempSocketPath();
    const tempServer = new IpcServer(createMockClient(), "token", tempPath);
    await tempServer.start();

    expect(existsSync(tempPath)).toBe(true);

    tempServer.stop();

    expect(existsSync(tempPath)).toBe(false);
  });

  test("ipcCall with explicit socket path works", async () => {
    const id = crypto.randomUUID();
    const result = await ipcCall<DaemonPingResult>(socketPath, {
      id,
      method: "daemon/ping",
      params: {},
    });

    expect(result.pid).toBe(process.pid);
    expect(typeof result.uptime).toBe("number");
  });

  test("connection timeout handling", async () => {
    // Create a socket path that doesn't exist
    const badPath = join(tmpdir(), `ddd-ipc-timeout-${Date.now()}.sock`);

    const id = crypto.randomUUID();

    try {
      await ipcCall(
        badPath,
        {
          id,
          method: "daemon/ping",
          params: {},
        },
        500
      );
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});
