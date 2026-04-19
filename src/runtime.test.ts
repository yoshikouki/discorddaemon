import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupStaleRuntimeState } from "./runtime";

describe("cleanupStaleRuntimeState", () => {
  let dir: string;
  let pidPath: string;
  let socketPath: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("removes stale pid and stale socket", async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-runtime-"));
    pidPath = join(dir, "ddd.pid");
    socketPath = join(dir, "daemon.sock");

    await writeFile(pidPath, "999999999");
    await writeFile(socketPath, "stale socket");

    const result = await cleanupStaleRuntimeState({ pidPath, socketPath });

    expect(result.pidRemoved).toBe(true);
    expect(result.socketRemoved).toBe(true);
    expect(await Bun.file(pidPath).exists()).toBe(false);
    expect(await Bun.file(socketPath).exists()).toBe(false);
  });

  test("leaves live pid and socket alone", async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-runtime-"));
    pidPath = join(dir, "ddd.pid");
    socketPath = join(dir, "daemon.sock");

    await writeFile(pidPath, String(process.pid));
    await writeFile(socketPath, "not a real socket");

    const result = await cleanupStaleRuntimeState({ pidPath, socketPath });

    expect(result.pidRemoved).toBe(false);
    expect(result.socketRemoved).toBe(false);
    expect(await Bun.file(pidPath).exists()).toBe(true);
    expect(await Bun.file(socketPath).exists()).toBe(true);
  });

  test("removes stale socket even when pid file is missing", async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-runtime-"));
    pidPath = join(dir, "ddd.pid");
    socketPath = join(dir, "daemon.sock");

    await writeFile(socketPath, "stale socket");

    const result = await cleanupStaleRuntimeState({ pidPath, socketPath });

    expect(result.pidRemoved).toBe(false);
    expect(result.socketRemoved).toBe(true);
    expect(await Bun.file(socketPath).exists()).toBe(false);
  });
});
