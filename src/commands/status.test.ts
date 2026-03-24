import { describe, expect, mock, test } from "bun:test";
import { statusCommand } from "./status";

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
});
