export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

export interface Logger {
  child(fields: Record<string, unknown>): Logger;
  error(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  mode?: "human" | "json";
  writer?: (entry: LogEntry) => void;
}

function formatHuman(entry: LogEntry): string {
  const { ts, level, msg, ...rest } = entry;
  const fields = Object.entries(rest)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return fields
    ? `${ts} [${level}] ${msg} ${fields}`
    : `${ts} [${level}] ${msg}`;
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function defaultWriter(mode: "human" | "json"): (entry: LogEntry) => void {
  const format = mode === "json" ? formatJson : formatHuman;
  return (entry: LogEntry) => {
    console.error(format(entry));
  };
}

class LoggerImpl implements Logger {
  private readonly write: (entry: LogEntry) => void;
  private readonly baseFields: Record<string, unknown>;

  constructor(
    writer: (entry: LogEntry) => void,
    baseFields: Record<string, unknown> = {}
  ) {
    this.write = writer;
    this.baseFields = baseFields;
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    this.emit("info", msg, fields);
  }

  warn(msg: string, fields?: Record<string, unknown>): void {
    this.emit("warn", msg, fields);
  }

  error(msg: string, fields?: Record<string, unknown>): void {
    this.emit("error", msg, fields);
  }

  child(fields: Record<string, unknown>): Logger {
    return new LoggerImpl(this.write, { ...this.baseFields, ...fields });
  }

  private emit(
    level: LogLevel,
    msg: string,
    fields?: Record<string, unknown>
  ): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.baseFields,
      ...fields,
    };
    this.write(entry);
  }
}

export function createLogger(options?: LoggerOptions): Logger {
  const mode = options?.mode ?? "human";
  const writer = options?.writer ?? defaultWriter(mode);
  return new LoggerImpl(writer);
}

/** No-op logger for use when no logger is provided. */
export const nullLogger: Logger = {
  info() {
    // intentional no-op
  },
  warn() {
    // intentional no-op
  },
  error() {
    // intentional no-op
  },
  child() {
    return nullLogger;
  },
};
