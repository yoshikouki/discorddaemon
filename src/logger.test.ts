import { describe, expect, mock, test } from "bun:test";
import { createLogger, type LogEntry, nullLogger } from "./logger";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;
const HUMAN_INFO_PID_RE = /\[info\] started pid=123/;
const HUMAN_INFO_CLEAN_RE = /\[info\] clean$/;

function collectingWriter(): {
  entries: LogEntry[];
  writer: (entry: LogEntry) => void;
} {
  const entries: LogEntry[] = [];
  return { entries, writer: (entry: LogEntry) => entries.push(entry) };
}

describe("createLogger", () => {
  test("info emits entry with level info", () => {
    const { entries, writer } = collectingWriter();
    const logger = createLogger({ writer });

    logger.info("hello");

    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("info");
    expect(entries[0].msg).toBe("hello");
    expect(entries[0].ts).toMatch(ISO_DATE_RE);
  });

  test("warn emits entry with level warn", () => {
    const { entries, writer } = collectingWriter();
    const logger = createLogger({ writer });

    logger.warn("caution");

    expect(entries[0].level).toBe("warn");
    expect(entries[0].msg).toBe("caution");
  });

  test("error emits entry with level error", () => {
    const { entries, writer } = collectingWriter();
    const logger = createLogger({ writer });

    logger.error("broken");

    expect(entries[0].level).toBe("error");
    expect(entries[0].msg).toBe("broken");
  });

  test("includes additional fields", () => {
    const { entries, writer } = collectingWriter();
    const logger = createLogger({ writer });

    logger.info("login", { user: "alice", count: 3 });

    expect(entries[0].user).toBe("alice");
    expect(entries[0].count).toBe(3);
  });

  test("child merges base fields into entries", () => {
    const { entries, writer } = collectingWriter();
    const logger = createLogger({ writer });
    const child = logger.child({ component: "hook" });

    child.info("executing", { script: "echo.sh" });

    expect(entries[0].component).toBe("hook");
    expect(entries[0].script).toBe("echo.sh");
  });

  test("child fields can be overridden per-call", () => {
    const { entries, writer } = collectingWriter();
    const logger = createLogger({ writer });
    const child = logger.child({ component: "hook" });

    child.info("override", { component: "ipc" });

    expect(entries[0].component).toBe("ipc");
  });

  test("nested child merges all ancestor fields", () => {
    const { entries, writer } = collectingWriter();
    const logger = createLogger({ writer });
    const child = logger.child({ a: 1 }).child({ b: 2 });

    child.info("nested");

    expect(entries[0].a).toBe(1);
    expect(entries[0].b).toBe(2);
  });
});

describe("output modes", () => {
  test("json mode outputs valid JSON to stderr", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = mock((...args: unknown[]) => lines.push(String(args[0])));

    try {
      const logger = createLogger({ mode: "json" });
      logger.info("test", { key: "val" });

      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.msg).toBe("test");
      expect(parsed.key).toBe("val");
      expect(parsed.level).toBe("info");
    } finally {
      console.error = original;
    }
  });

  test("human mode outputs readable format to stderr", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = mock((...args: unknown[]) => lines.push(String(args[0])));

    try {
      const logger = createLogger({ mode: "human" });
      logger.info("started", { pid: 123 });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(HUMAN_INFO_PID_RE);
    } finally {
      console.error = original;
    }
  });

  test("human mode without fields omits trailing space", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = mock((...args: unknown[]) => lines.push(String(args[0])));

    try {
      const logger = createLogger({ mode: "human" });
      logger.info("clean");

      expect(lines[0]).toMatch(HUMAN_INFO_CLEAN_RE);
    } finally {
      console.error = original;
    }
  });
});

describe("nullLogger", () => {
  test("does not throw on any method", () => {
    nullLogger.info("noop");
    nullLogger.warn("noop");
    nullLogger.error("noop");
    const child = nullLogger.child({ x: 1 });
    child.info("still noop");
  });
});
