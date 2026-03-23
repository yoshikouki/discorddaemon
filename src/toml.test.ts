import { describe, expect, test } from "vitest";
import { parseTOML } from "./toml";

describe("parseTOML", () => {
  test("parses sections and string values", () => {
    const input = `
[bot]
token = "abc123"

[channels.general]
id = "111"
on_message = "./hooks/echo.sh"
`;
    const result = parseTOML(input);
    expect(result.bot?.token).toBe("abc123");
    expect(result["channels.general"]?.id).toBe("111");
    expect(result["channels.general"]?.on_message).toBe("./hooks/echo.sh");
  });

  test("ignores comments and blank lines", () => {
    const input = `
# This is a comment
[bot]
# Another comment
token = "secret"

`;
    const result = parseTOML(input);
    expect(result.bot?.token).toBe("secret");
  });

  test("handles top-level keys under empty section", () => {
    const input = `key = "value"`;
    const result = parseTOML(input);
    expect(result[""]?.key).toBe("value");
  });

  test("handles empty string values", () => {
    const input = `
[bot]
token = ""
`;
    const result = parseTOML(input);
    expect(result.bot?.token).toBe("");
  });

  test("handles keys with hyphens and numbers", () => {
    const input = `
[channels.my-channel-1]
id = "123"
`;
    const result = parseTOML(input);
    expect(result["channels.my-channel-1"]?.id).toBe("123");
  });

  test("throws on invalid lines", () => {
    expect(() => parseTOML("invalid")).toThrow("Invalid TOML line: invalid");
  });

  test("throws on unquoted values", () => {
    expect(() => parseTOML("key = value")).toThrow("Invalid TOML line");
  });

  test("returns empty object for empty input", () => {
    expect(parseTOML("")).toEqual({});
    expect(parseTOML("\n\n")).toEqual({});
  });

  test("handles multiple channels", () => {
    const input = `
[bot]
token = "tok"

[channels.general]
id = "111"
on_message = "./hooks/a.sh"

[channels.random]
id = "222"
on_message = "./hooks/b.sh"
`;
    const result = parseTOML(input);
    expect(Object.keys(result)).toHaveLength(3);
    expect(result["channels.general"]?.id).toBe("111");
    expect(result["channels.random"]?.id).toBe("222");
  });
});
