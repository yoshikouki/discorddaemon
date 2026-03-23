import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { parseToml } from "./toml.ts";

describe("parseToml", () => {
  test("parses ddd.toml.example", () => {
    const source = readFileSync(resolve("ddd.toml.example"), "utf-8");

    expect(parseToml(source)).toEqual({
      bot: {
        token: "",
      },
      channels: {
        general: {
          id: "CHANNEL_ID_HERE",
          on_message: "./hooks/echo.sh",
        },
      },
    });
  });
});
