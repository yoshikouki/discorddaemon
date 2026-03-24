import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveToken } from "./config";

describe("loadConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  async function writeConfig(content: string): Promise<string> {
    const path = join(dir, "ddd.toml");
    await Bun.write(path, content);
    return path;
  }

  test("loads a valid config", async () => {
    const path = await writeConfig(`
[bot]
token = "my-token"

[channels.general]
id = "111"
on_message = "./hooks/echo.sh"
`);
    const config = await loadConfig(path);
    expect(config.token).toBe("my-token");
    expect(config.configDir).toBe(dir);
    expect(config.channels.size).toBe(1);
    expect(config.channels.get("111")).toEqual({
      id: "111",
      name: "general",
      on_message: "./hooks/echo.sh",
    });
  });

  test("falls back to DDD_TOKEN env var", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "env-token";
    try {
      const path = await writeConfig(`
[bot]
token = ""

[channels.general]
id = "111"
on_message = "./hooks/echo.sh"
`);
      const config = await loadConfig(path);
      expect(config.token).toBe("env-token");
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("prefers config token over env token", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "env-token";
    try {
      const path = await writeConfig(`
[bot]
token = "config-token"

[channels.general]
id = "111"
on_message = "./hooks/echo.sh"
`);
      const config = await loadConfig(path);
      expect(config.token).toBe("config-token");
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("throws if config file not found", async () => {
    await expect(loadConfig(join(dir, "missing.toml"))).rejects.toThrow(
      "Config file not found"
    );
  });

  test("throws if no token", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "";
    try {
      const path = await writeConfig(`
[bot]
token = ""
`);
      await expect(loadConfig(path)).rejects.toThrow("Bot token is required");
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("throws if channel missing id", async () => {
    const path = await writeConfig(`
[bot]
token = "tok"

[channels.broken]
on_message = "./hooks/echo.sh"
`);
    await expect(loadConfig(path)).rejects.toThrow(
      "missing required field: id"
    );
  });

  test("throws if channel missing on_message", async () => {
    const path = await writeConfig(`
[bot]
token = "tok"

[channels.broken]
id = "111"
`);
    await expect(loadConfig(path)).rejects.toThrow(
      "missing required field: on_message"
    );
  });

  test("loads with [bot] section omitted when DDD_TOKEN is set", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "env-token";
    try {
      const path = await writeConfig(`
[channels.general]
id = "111"
on_message = "./hooks/echo.sh"
`);
      const config = await loadConfig(path);
      expect(config.token).toBe("env-token");
      expect(config.channels.size).toBe(1);
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("loads with no channels defined", async () => {
    const path = await writeConfig(`
[bot]
token = "tok"
`);
    const config = await loadConfig(path);
    expect(config.token).toBe("tok");
    expect(config.channels.size).toBe(0);
  });

  test("loads empty TOML file with only DDD_TOKEN", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "env-token";
    try {
      const path = await writeConfig("");
      const config = await loadConfig(path);
      expect(config.token).toBe("env-token");
      expect(config.channels.size).toBe(0);
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("loads multiple channels", async () => {
    const path = await writeConfig(`
[bot]
token = "tok"

[channels.general]
id = "111"
on_message = "./hooks/a.sh"

[channels.random]
id = "222"
on_message = "./hooks/b.sh"
`);
    const config = await loadConfig(path);
    expect(config.channels.size).toBe(2);
    expect(config.channels.get("111")?.name).toBe("general");
    expect(config.channels.get("222")?.name).toBe("random");
  });
});

describe("resolveToken", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-resolve-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("returns explicit token argument first", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "env-token";
    try {
      const configPath = join(dir, "ddd.toml");
      await Bun.write(configPath, '[bot]\ntoken = "config-token"\n');
      const token = await resolveToken({
        token: "explicit",
        config: configPath,
      });
      expect(token).toBe("explicit");
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("returns DDD_TOKEN env when no explicit token", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "env-token";
    try {
      const token = await resolveToken();
      expect(token).toBe("env-token");
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("falls back to toml token when no env var", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "";
    try {
      const configPath = join(dir, "ddd.toml");
      await Bun.write(configPath, '[bot]\ntoken = "toml-token"\n');
      const token = await resolveToken({ config: configPath });
      expect(token).toBe("toml-token");
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("does not error when toml file does not exist", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "env-token";
    try {
      const token = await resolveToken({ config: join(dir, "missing.toml") });
      expect(token).toBe("env-token");
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("throws when no token source available", async () => {
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "";
    try {
      await expect(
        resolveToken({ config: join(dir, "missing.toml") })
      ).rejects.toThrow("Bot token is required");
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });
});
