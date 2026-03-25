import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ipcCall } from "./client";
import { ConnectionRefusedError } from "./protocol";

describe("ipcCall", () => {
  test("throws ConnectionRefusedError when socket does not exist", async () => {
    const nonExistentSocket = join(
      tmpdir(),
      `ddd-test-nonexistent-${Date.now()}.sock`
    );

    try {
      await ipcCall(nonExistentSocket, {
        id: "test-1",
        method: "daemon/ping",
        params: {},
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionRefusedError);
    }
  });

  test("throws ConnectionRefusedError with descriptive message", async () => {
    const nonExistentSocket = join(
      tmpdir(),
      `ddd-test-noexist-${Date.now()}.sock`
    );

    try {
      await ipcCall(nonExistentSocket, {
        id: "test-2",
        method: "daemon/ping",
        params: {},
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionRefusedError);
      expect((err as Error).message).toBeTruthy();
    }
  });
});
