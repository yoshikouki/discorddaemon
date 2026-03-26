import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AUDIT_PATH } from "./paths";

export type AuditEvent =
  | "daemon_started"
  | "daemon_stopped"
  | "message_received"
  | "hook_executed"
  | "reply_sent"
  | "reply_failed"
  | "ipc_request";

export interface AuditEntry {
  event: AuditEvent;
  ts: string;
  [key: string]: unknown;
}

export interface AuditWriter {
  write(event: AuditEvent, fields?: Record<string, unknown>): void;
}

export interface AuditWriterOptions {
  writer?: (line: string) => void;
}

function defaultFileWriter(): (line: string) => void {
  let dirEnsured = false;
  return (line: string) => {
    if (!dirEnsured) {
      mkdirSync(dirname(AUDIT_PATH), { recursive: true });
      dirEnsured = true;
    }
    appendFileSync(AUDIT_PATH, `${line}\n`);
  };
}

export function createAuditWriter(options?: AuditWriterOptions): AuditWriter {
  const writer = options?.writer ?? defaultFileWriter();
  return {
    write(event: AuditEvent, fields?: Record<string, unknown>): void {
      const entry: AuditEntry = {
        ts: new Date().toISOString(),
        event,
        ...fields,
      };
      writer(JSON.stringify(entry));
    },
  };
}

/** No-op audit writer for use when no audit is needed. */
export const nullAuditWriter: AuditWriter = {
  write() {
    // intentional no-op
  },
};
