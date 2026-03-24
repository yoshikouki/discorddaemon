import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveConfigDir, resolveDataDir } from "./paths";

describe("resolveConfigDir", () => {
  let originalXdgConfigHome: string | undefined;

  beforeEach(() => {
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      // biome-ignore lint/performance/noDelete: process.env requires delete to unset
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
  });

  test("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/custom/config";
    expect(resolveConfigDir()).toBe("/custom/config/ddd");
  });

  test("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    // biome-ignore lint/performance/noDelete: process.env requires delete to unset
    delete process.env.XDG_CONFIG_HOME;
    expect(resolveConfigDir()).toBe(join(homedir(), ".config", "ddd"));
  });

  test("falls back to ~/.config when XDG_CONFIG_HOME is empty", () => {
    process.env.XDG_CONFIG_HOME = "";
    expect(resolveConfigDir()).toBe(join(homedir(), ".config", "ddd"));
  });
});

describe("resolveDataDir", () => {
  let originalXdgDataHome: string | undefined;

  beforeEach(() => {
    originalXdgDataHome = process.env.XDG_DATA_HOME;
  });

  afterEach(() => {
    if (originalXdgDataHome === undefined) {
      // biome-ignore lint/performance/noDelete: process.env requires delete to unset
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
  });

  test("uses XDG_DATA_HOME when set", () => {
    process.env.XDG_DATA_HOME = "/custom/data";
    expect(resolveDataDir()).toBe("/custom/data/ddd");
  });

  test("falls back to ~/.local/share when XDG_DATA_HOME is unset", () => {
    // biome-ignore lint/performance/noDelete: process.env requires delete to unset
    delete process.env.XDG_DATA_HOME;
    expect(resolveDataDir()).toBe(join(homedir(), ".local", "share", "ddd"));
  });

  test("falls back to ~/.local/share when XDG_DATA_HOME is empty", () => {
    process.env.XDG_DATA_HOME = "";
    expect(resolveDataDir()).toBe(join(homedir(), ".local", "share", "ddd"));
  });
});
