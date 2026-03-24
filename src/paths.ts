import { homedir } from "node:os";
import { join } from "node:path";

export function resolveConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "ddd");
}

export function resolveDataDir(): string {
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "ddd");
}

// Config: user-editable files (ddd.toml, hooks/)
export const CONFIG_DIR = resolveConfigDir();
export const CONFIG_PATH = join(CONFIG_DIR, "ddd.toml");

// Data: runtime/state files (ddd.pid, ddd.log)
export const DATA_DIR = resolveDataDir();
export const PID_PATH = join(DATA_DIR, "ddd.pid");
export const LOG_PATH = join(DATA_DIR, "ddd.log");
