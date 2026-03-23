import { describe, expect, test } from "vitest";
import { parseCliArgs } from "./cli.ts";

describe("parseCliArgs", () => {
    test("parses ddd init", () => {
        expect(parseCliArgs(["init"])).toEqual({ name: "init" });
    });

    test("parses ddd start with default config", () => {
        expect(parseCliArgs(["start"])).toEqual({
            name: "start",
            configPath: "ddd.toml",
        });
    });

    test("parses ddd start -c path", () => {
        expect(parseCliArgs(["start", "-c", "custom.toml"])).toEqual({
            name: "start",
            configPath: "custom.toml",
        });
    });
});
