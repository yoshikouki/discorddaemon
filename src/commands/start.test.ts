import { describe, expect, mock, test } from "bun:test";
import { runForegroundLoop } from "./start";

describe("start command", () => {
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
