import { describe, expect, test } from "bun:test";
import { StatsTracker } from "./stats";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

describe("StatsTracker", () => {
  test("initial state has zero counters", () => {
    const stats = new StatsTracker(3);
    const result = stats.getStats();

    expect(result.messagesReceived).toBe(0);
    expect(result.hooksExecuted).toBe(0);
    expect(result.hookErrors).toBe(0);
    expect(result.repliesSent).toBe(0);
    expect(result.lastEventTime).toBeNull();
    expect(result.channelsWatched).toBe(3);
  });

  test("recordMessageReceived increments counter", () => {
    const stats = new StatsTracker(1);
    stats.recordMessageReceived();
    stats.recordMessageReceived();

    expect(stats.getStats().messagesReceived).toBe(2);
  });

  test("recordHookExecuted increments counter", () => {
    const stats = new StatsTracker(1);
    stats.recordHookExecuted();

    expect(stats.getStats().hooksExecuted).toBe(1);
  });

  test("recordHookError increments counter", () => {
    const stats = new StatsTracker(1);
    stats.recordHookError();
    stats.recordHookError();
    stats.recordHookError();

    expect(stats.getStats().hookErrors).toBe(3);
  });

  test("recordReplySent increments counter", () => {
    const stats = new StatsTracker(1);
    stats.recordReplySent();

    expect(stats.getStats().repliesSent).toBe(1);
  });

  test("lastEventTime updates on each record call", () => {
    const stats = new StatsTracker(1);
    expect(stats.getStats().lastEventTime).toBeNull();

    stats.recordMessageReceived();
    const t1 = stats.getStats().lastEventTime;
    expect(t1).toMatch(ISO_DATE_RE);

    stats.recordHookExecuted();
    const t2 = stats.getStats().lastEventTime;
    expect(t2).not.toBeNull();
    // t2 should be >= t1
    expect(new Date(t2 as string).getTime()).toBeGreaterThanOrEqual(
      new Date(t1 as string).getTime()
    );
  });

  test("getStats returns a snapshot (not a live reference)", () => {
    const stats = new StatsTracker(2);
    const snap1 = stats.getStats();
    stats.recordMessageReceived();
    const snap2 = stats.getStats();

    expect(snap1.messagesReceived).toBe(0);
    expect(snap2.messagesReceived).toBe(1);
  });

  test("channelsWatched is set from constructor", () => {
    expect(new StatsTracker(0).getStats().channelsWatched).toBe(0);
    expect(new StatsTracker(10).getStats().channelsWatched).toBe(10);
  });
});
