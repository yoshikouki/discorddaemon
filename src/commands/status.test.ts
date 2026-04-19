import { describe, expect, mock, test } from "bun:test";
import { formatUptime, statusCommand } from "./status";

const noop = () => {
  // no-op mock
};

const liveState = async () => ({
  pid: 1234,
  pidAlive: true,
  socketConnectable: true,
  socketExists: true,
});

describe("statusCommand", () => {
  test("uses service manager status when available", async () => {
    const exit = mock((_code: number) => noop());
    const serviceManager = {
      start: mock(() => Promise.resolve()),
      status: mock(() => Promise.resolve({ running: true, pid: 4321 })),
      stop: mock(() => Promise.resolve()),
    };
    const fetchInfo = mock(() => Promise.resolve(null));

    await statusCommand({
      serviceManager: serviceManager as never,
      fetchInfo,
      exit,
    });

    expect(serviceManager.status).toHaveBeenCalledTimes(1);
    expect(fetchInfo).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("falls back to legacy runtime inspection when no service manager is available", async () => {
    const exit = mock((_code: number) => noop());
    const inspectRuntimeState = mock(liveState);

    await statusCommand({
      inspectRuntimeState,
      fetchInfo: async () => null,
      exit,
      resolveServiceManager: async () => null,
    });

    expect(inspectRuntimeState).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("reports running daemon", async () => {
    const exit = mock((_code: number) => noop());
    await statusCommand({
      inspectRuntimeState: liveState,
      fetchInfo: async () => null,
      exit,
      resolveServiceManager: async () => null,
    });
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("reports not running when no PID file", async () => {
    const exit = mock((_code: number) => noop());
    await statusCommand({
      inspectRuntimeState: async () => ({
        pid: null,
        pidAlive: false,
        socketConnectable: false,
        socketExists: true,
      }),
      exit,
      resolveServiceManager: async () => null,
    });
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("reports stale PID file without mutating it", async () => {
    const exit = mock((_code: number) => noop());
    await statusCommand({
      inspectRuntimeState: async () => ({
        pid: 9999,
        pidAlive: false,
        socketConnectable: true,
        socketExists: true,
      }),
      exit,
      resolveServiceManager: async () => null,
    });
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("reports stale socket file without mutating it", async () => {
    const exit = mock((_code: number) => noop());
    const lines: string[] = [];
    const original = console.error;
    console.error = mock((...args: unknown[]) => lines.push(String(args[0])));

    try {
      await statusCommand({
        inspectRuntimeState: async () => ({
          pid: null,
          pidAlive: false,
          socketConnectable: false,
          socketExists: true,
        }),
        exit,
        resolveServiceManager: async () => null,
      });

      expect(exit).toHaveBeenCalledWith(1);
      expect(lines.some((l) => l.includes("stale socket file present"))).toBe(
        true
      );
    } finally {
      console.error = original;
    }
  });

  test("shows rich info when IPC available", async () => {
    const exit = mock((_code: number) => noop());
    const lines: string[] = [];
    const original = console.error;
    console.error = mock((...args: unknown[]) => lines.push(String(args[0])));

    try {
      await statusCommand({
        inspectRuntimeState: liveState,
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
        resolveServiceManager: async () => null,
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
        inspectRuntimeState: liveState,
        fetchInfo: async () => null,
        exit,
        resolveServiceManager: async () => null,
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
