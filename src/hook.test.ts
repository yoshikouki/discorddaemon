import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { executeHook } from "./hook";
import type { HookInput } from "./types";

const fixturesDir = join(import.meta.dirname, "fixtures");

const dummyInput: HookInput = {
  message: {
    id: "msg-1",
    content: "hello",
    author: { id: "user-1", username: "alice", bot: false },
    channel: { id: "ch-1", name: "general" },
    guild: { id: "guild-1", name: "Test Guild" },
    timestamp: "2025-01-01T00:00:00.000Z",
  },
};

describe("executeHook", () => {
  test("executes a hook and captures stdout", async () => {
    const result = await executeHook(
      join(fixturesDir, "greeting.sh"),
      dummyInput
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe("hello from hook");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  test("pipes input JSON to stdin", async () => {
    const result = await executeHook(join(fixturesDir, "echo.sh"), dummyInput);
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.message.content).toBe("hello");
  });

  test("captures exit code and stderr on failure", async () => {
    const result = await executeHook(join(fixturesDir, "fail.sh"), dummyInput);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("something went wrong");
  });

  test("times out slow hooks", async () => {
    const result = await executeHook(join(fixturesDir, "slow.sh"), dummyInput, {
      timeout: 100,
    });
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  test("can be aborted via AbortSignal", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await executeHook(join(fixturesDir, "slow.sh"), dummyInput, {
      timeout: 5000,
      signal: controller.signal,
    });
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  test("throws for non-existent script path", async () => {
    await expect(
      executeHook(join(fixturesDir, "nonexistent.sh"), dummyInput)
    ).rejects.toThrow();
  });
});
