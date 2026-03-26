import { describe, expect, mock, test } from "bun:test";
import { formatUptime, statusCommand } from "./status";

const noop = () => {
  // no-op mock
};

describe("statusCommand", () => {
  test("reports running daemon", async () => {
    const exit = mock((_code: number) => noop());
    await statusCommand({
      readPid: async () => 1234,
      isProcessRunning: () => true,
      removePid: async () => noop(),
      fetchInfo: async () => null,
      exit,
    });
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("reports not running when no PID file", async () => {
    const exit = mock((_code: number) => noop());
    await statusCommand({
      readPid: async () => null,
      isProcessRunning: () => false,
      removePid: async () => noop(),
      exit,
    });
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("cleans up stale PID file", async () => {
    const exit = mock((_code: number) => noop());
    const remove = mock(async () => noop());
    await statusCommand({
      readPid: async () => 9999,
      isProcessRunning: () => false,
      removePid: remove,
      exit,
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(remove).toHaveBeenCalled();
  });

  test("shows rich info when IPC available", async () => {
    const exit = mock((_code: number) => noop());
    const lines: string[] = [];
    const original = console.error;
    console.error = mock((...args: unknown[]) => lines.push(String(args[0])));

    try {
      await statusCommand({
        readPid: async () => 1234,
        isProcessRunning: () => true,
        removePid: async () => noop(),
        fetchInfo: async () => ({
          uptime: 3661,
          pid: 1234,
          tokenFingerprint: "abcd1234",
          channelsWatched: 3,
          messagesReceived: 42,
          hooksExecuted: 40,
          hookErrors: 2,
          repliesSent: 38,
          lastEventTime: "2026-03-26T12:00:00.000Z",
        }),
        exit,
      });

      expect(exit).toHaveBeenCalledWith(0);
      expect(lines.some((l) => l.includes("PID: 1234"))).toBe(true);
      expect(lines.some((l) => l.includes("1h 1m 1s"))).toBe(true);
      expect(lines.some((l) => l.includes("Channels: 3"))).toBe(true);
      expect(lines.some((l) => l.includes("Messages: 42"))).toBe(true);
      expect(lines.some((l) => l.includes("Hooks executed: 40"))).toBe(true);
      expect(lines.some((l) => l.includes("Errors: 2"))).toBe(true);
      expect(lines.some((l) => l.includes("Replies sent: 38"))).toBe(true);
      expect(lines.some((l) => l.includes("Last event:"))).toBe(true);
    } finally {
      console.error = original;
    }
  });

  test("falls back to PID-only when IPC fails", async () => {
    const exit = mock((_code: number) => noop());
    const lines: string[] = [];
    const original = console.error;
    console.error = mock((...args: unknown[]) => lines.push(String(args[0])));

    try {
      await statusCommand({
        readPid: async () => 1234,
        isProcessRunning: () => true,
        removePid: async () => noop(),
        fetchInfo: async () => null,
        exit,
      });

      expect(exit).toHaveBeenCalledWith(0);
      expect(lines.some((l) => l.includes("PID: 1234"))).toBe(true);
      expect(lines.some((l) => l.includes("Uptime:"))).toBe(false);
    } finally {
      console.error = original;
    }
  });
});

describe("formatUptime", () => {
  test("seconds only", () => {
    expect(formatUptime(45)).toBe("45s");
  });

  test("minutes and seconds", () => {
    expect(formatUptime(125)).toBe("2m 5s");
  });

  test("hours, minutes, and seconds", () => {
    expect(formatUptime(3661)).toBe("1h 1m 1s");
  });

  test("exact hours", () => {
    expect(formatUptime(7200)).toBe("2h 0s");
  });

  test("zero seconds", () => {
    expect(formatUptime(0)).toBe("0s");
  });
});
