import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProcessRunning, readPid, removePid, writePid } from "./pid";

describe("pid", () => {
  let dir: string;
  let pidPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-pid-"));
    pidPath = join(dir, "ddd.pid");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  describe("writePid", () => {
    test("writes pid to file", async () => {
      await writePid(12_345, pidPath);
      const content = await Bun.file(pidPath).text();
      expect(content).toBe("12345");
    });
  });

  describe("readPid", () => {
    test("returns pid from valid file", async () => {
      await Bun.write(pidPath, "12345");
      const pid = await readPid(pidPath);
      expect(pid).toBe(12_345);
    });

    test("returns null when file does not exist", async () => {
      const pid = await readPid(join(dir, "nonexistent.pid"));
      expect(pid).toBeNull();
    });

    test("returns null for non-numeric content", async () => {
      await Bun.write(pidPath, "not-a-number");
      const pid = await readPid(pidPath);
      expect(pid).toBeNull();
    });

    test("trims whitespace", async () => {
      await Bun.write(pidPath, "  12345\n");
      const pid = await readPid(pidPath);
      expect(pid).toBe(12_345);
    });
  });

  describe("removePid", () => {
    test("removes existing file", async () => {
      await Bun.write(pidPath, "12345");
      await removePid(pidPath);
      expect(await Bun.file(pidPath).exists()).toBe(false);
    });

    test("succeeds when file does not exist", async () => {
      await removePid(join(dir, "nonexistent.pid"));
    });
  });

  describe("isProcessRunning", () => {
    test("returns true for current process", () => {
      expect(isProcessRunning(process.pid)).toBe(true);
    });

    test("returns false for non-existent pid", () => {
      expect(isProcessRunning(999_999_999)).toBe(false);
    });
  });
});
