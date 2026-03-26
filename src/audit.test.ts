import { describe, expect, test } from "bun:test";
import { type AuditEntry, createAuditWriter, nullAuditWriter } from "./audit";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

function collectingWriter(): {
  lines: string[];
  writer: (line: string) => void;
} {
  const lines: string[] = [];
  return { lines, writer: (line: string) => lines.push(line) };
}

describe("createAuditWriter", () => {
  test("writes valid NDJSON for each event", () => {
    const { lines, writer } = collectingWriter();
    const audit = createAuditWriter({ writer });

    audit.write("message_received", { channel: "general", user: "alice" });

    expect(lines).toHaveLength(1);
    const entry: AuditEntry = JSON.parse(lines[0]);
    expect(entry.event).toBe("message_received");
    expect(entry.channel).toBe("general");
    expect(entry.user).toBe("alice");
    expect(entry.ts).toMatch(ISO_DATE_RE);
  });

  test("daemon_started event", () => {
    const { lines, writer } = collectingWriter();
    const audit = createAuditWriter({ writer });

    audit.write("daemon_started", { user: "bot#1234", channels: 3 });

    const entry = JSON.parse(lines[0]);
    expect(entry.event).toBe("daemon_started");
    expect(entry.channels).toBe(3);
  });

  test("hook_executed event with duration", () => {
    const { lines, writer } = collectingWriter();
    const audit = createAuditWriter({ writer });

    audit.write("hook_executed", {
      script: "./hooks/echo.sh",
      success: true,
      duration_ms: 42,
    });

    const entry = JSON.parse(lines[0]);
    expect(entry.event).toBe("hook_executed");
    expect(entry.success).toBe(true);
    expect(entry.duration_ms).toBe(42);
  });

  test("works without additional fields", () => {
    const { lines, writer } = collectingWriter();
    const audit = createAuditWriter({ writer });

    audit.write("daemon_stopped");

    const entry = JSON.parse(lines[0]);
    expect(entry.event).toBe("daemon_stopped");
    expect(entry.ts).toBeDefined();
  });

  test("multiple writes append correctly", () => {
    const { lines, writer } = collectingWriter();
    const audit = createAuditWriter({ writer });

    audit.write("message_received");
    audit.write("hook_executed");
    audit.write("reply_sent");

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).event).toBe("message_received");
    expect(JSON.parse(lines[1]).event).toBe("hook_executed");
    expect(JSON.parse(lines[2]).event).toBe("reply_sent");
  });
});

describe("nullAuditWriter", () => {
  test("does not throw", () => {
    nullAuditWriter.write("daemon_started", { foo: "bar" });
    nullAuditWriter.write("daemon_stopped");
  });
});
