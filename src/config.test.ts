import { describe, expect, test } from "vitest";
import { parseConfig } from "./config";

describe("parseConfig", () => {
  test("parses a valid config", () => {
    const config = parseConfig(`
[bot]
token = "my-token"

[channels.general]
id = "111"
on_message = "./hooks/echo.sh"
`);
    expect(config.token).toBe("my-token");
    expect(config.channels.size).toBe(1);
    expect(config.channels.get("111")).toEqual({
      id: "111",
      name: "general",
      on_message: "./hooks/echo.sh",
    });
  });

  test("falls back to env token when config token is empty", () => {
    const config = parseConfig(
      `
[bot]
token = ""

[channels.general]
id = "111"
on_message = "./hooks/echo.sh"
`,
      "env-token"
    );
    expect(config.token).toBe("env-token");
  });

  test("prefers config token over env token", () => {
    const config = parseConfig(
      `
[bot]
token = "config-token"

[channels.general]
id = "111"
on_message = "./hooks/echo.sh"
`,
      "env-token"
    );
    expect(config.token).toBe("config-token");
  });

  test("throws if no token available", () => {
    expect(() =>
      parseConfig(`
[bot]
token = ""
`)
    ).toThrow("Bot token is required");
  });

  test("throws if channel missing id", () => {
    expect(() =>
      parseConfig(`
[bot]
token = "tok"

[channels.broken]
on_message = "./hooks/echo.sh"
`)
    ).toThrow('Channel "broken" is missing required field: id');
  });

  test("throws if channel missing on_message", () => {
    expect(() =>
      parseConfig(`
[bot]
token = "tok"

[channels.broken]
id = "111"
`)
    ).toThrow('Channel "broken" is missing required field: on_message');
  });

  test("loads multiple channels", () => {
    const config = parseConfig(`
[bot]
token = "tok"

[channels.general]
id = "111"
on_message = "./hooks/a.sh"

[channels.random]
id = "222"
on_message = "./hooks/b.sh"
`);
    expect(config.channels.size).toBe(2);
    expect(config.channels.get("111")?.name).toBe("general");
    expect(config.channels.get("222")?.name).toBe("random");
  });

  test("ignores non-channel sections", () => {
    const config = parseConfig(`
[bot]
token = "tok"

[channels.general]
id = "111"
on_message = "./hooks/echo.sh"
`);
    expect(config.channels.size).toBe(1);
  });
});
