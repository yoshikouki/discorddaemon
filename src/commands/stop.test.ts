import { describe, expect, mock, test } from "bun:test";
import { stopCommand } from "./stop";

const noop = () => {
  // no-op mock
};

function makeDeps(
  overrides: { pid?: number | null; running?: boolean | boolean[] } = {}
) {
  const killed: { pid: number; signal: NodeJS.Signals }[] = [];
  let runningCalls = 0;
  const runningValues = Array.isArray(overrides.running)
    ? overrides.running
    : [overrides.running ?? true];

  return {
    deps: {
      readPid: mock(async () => ("pid" in overrides ? overrides.pid : 1234)),
      removePid: mock(async () => noop()),
      isProcessRunning: mock((_pid: number) => {
        const val =
          runningValues[Math.min(runningCalls, runningValues.length - 1)];
        runningCalls++;
        return val;
      }),
      kill: mock((pid: number, signal: NodeJS.Signals) => {
        killed.push({ pid, signal });
      }),
      sleep: mock(async () => noop()),
    },
    killed,
  };
}

describe("stopCommand", () => {
  test("stops a running daemon with SIGTERM", async () => {
    const { deps, killed } = makeDeps({
      pid: 5678,
      running: [true, false],
    });

    await stopCommand(deps);

    expect(killed).toEqual([{ pid: 5678, signal: "SIGTERM" }]);
    expect(deps.removePid).toHaveBeenCalled();
  });

  test("throws when no PID file exists", async () => {
    const { deps } = makeDeps({ pid: null });
    await expect(stopCommand(deps)).rejects.toThrow("No PID file found");
  });

  test("throws and cleans up stale PID file", async () => {
    const { deps } = makeDeps({ pid: 9999, running: false });
    await expect(stopCommand(deps)).rejects.toThrow("stale PID file");
    expect(deps.removePid).toHaveBeenCalled();
  });

  test("sends SIGKILL after timeout", async () => {
    let callCount = 0;
    const { deps, killed } = makeDeps({
      pid: 5678,
      running: true,
    });
    deps.sleep = mock((_ms: number) => {
      callCount++;
      if (callCount >= 21) {
        deps.isProcessRunning = mock(() => false);
      }
      return Promise.resolve();
    });

    const originalDateNow = Date.now;
    let fakeNow = originalDateNow();
    Date.now = () => {
      fakeNow += 600;
      return fakeNow;
    };

    try {
      await stopCommand(deps);
      const signals = killed.map((k) => k.signal);
      expect(signals).toContain("SIGTERM");
      expect(signals).toContain("SIGKILL");
    } finally {
      Date.now = originalDateNow;
    }
  });
});
