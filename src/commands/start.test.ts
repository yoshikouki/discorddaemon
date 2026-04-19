import { describe, expect, mock, test } from "bun:test";
import { runForegroundLoop, startCommand } from "./start";

describe("start command", () => {
  test("startCommand uses service manager when available", async () => {
    const serviceManager = {
      start: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
      status: mock(() => Promise.resolve({ running: true, pid: 42 })),
    };

    await startCommand(
      { foreground: false },
      { serviceManager: serviceManager as never }
    );

    expect(serviceManager.start).toHaveBeenCalledTimes(1);
  });

  test("startCommand rejects custom config in managed mode", async () => {
    const serviceManager = {
      start: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
      status: mock(() => Promise.resolve({ running: true, pid: 42 })),
    };

    await expect(
      startCommand(
        { config: "custom.toml", foreground: false },
        { serviceManager: serviceManager as never }
      )
    ).rejects.toThrow("Custom config is not supported");

    expect(serviceManager.start).not.toHaveBeenCalled();
  });

  test("startCommand falls back to legacy daemonization when no service manager is available", async () => {
    const startDaemon = mock(() => Promise.resolve());

    await startCommand(
      { config: "custom.toml", foreground: false },
      {
        resolveServiceManager: async () => null,
        serviceManager: null,
        startDaemon,
      }
    );

    expect(startDaemon).toHaveBeenCalledTimes(1);
  });

  test("runForegroundLoop waits for shutdown after daemon starts", async () => {
    const daemon = {
      start: mock(() => Promise.resolve()),
    };

    let releaseShutdown!: () => void;
    const waitForShutdown = mock(
      () =>
        new Promise<void>((resolve) => {
          releaseShutdown = resolve;
        })
    );

    let finished = false;
    const run = runForegroundLoop(daemon, waitForShutdown).then(() => {
      finished = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(daemon.start).toHaveBeenCalledTimes(1);
    expect(waitForShutdown).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);

    releaseShutdown();
    await run;

    expect(finished).toBe(true);
  });
});
