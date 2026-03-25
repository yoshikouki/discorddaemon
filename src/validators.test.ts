import { describe, expect, test } from "bun:test";
import {
  VALID_AUTHOR_TYPES,
  VALID_HAS_VALUES,
  validateEnum,
  validateLimit,
  validateMutuallyExclusive,
  validateOffset,
  validateRequired,
  validateSearchFilters,
} from "./validators";

describe("validators", () => {
  describe("validateLimit", () => {
    test("accepts value within range", () => {
      expect(() => validateLimit(50, 1, 100)).not.toThrow();
    });

    test("accepts min boundary", () => {
      expect(() => validateLimit(1, 1, 100)).not.toThrow();
    });

    test("accepts max boundary", () => {
      expect(() => validateLimit(100, 1, 100)).not.toThrow();
    });

    test("rejects below min", () => {
      expect(() => validateLimit(0, 1, 100)).toThrow("Limit must be 1-100");
    });

    test("rejects above max", () => {
      expect(() => validateLimit(101, 1, 100)).toThrow("Limit must be 1-100");
    });

    test("rejects NaN", () => {
      expect(() => validateLimit(Number.NaN, 1, 100)).toThrow(
        "Limit must be 1-100"
      );
    });

    test("uses custom label when provided", () => {
      expect(() => validateLimit(0, 1, 25, "Custom error")).toThrow(
        "Custom error"
      );
    });

    test("works with different ranges", () => {
      expect(() => validateLimit(10, 1, 25)).not.toThrow();
      expect(() => validateLimit(26, 1, 25)).toThrow("Limit must be 1-25");
    });
  });

  describe("validateOffset", () => {
    test("accepts zero", () => {
      expect(() => validateOffset(0)).not.toThrow();
    });

    test("accepts max boundary", () => {
      expect(() => validateOffset(9975)).not.toThrow();
    });

    test("accepts value within range", () => {
      expect(() => validateOffset(500)).not.toThrow();
    });

    test("rejects negative", () => {
      expect(() => validateOffset(-1)).toThrow("Offset must be 0-9975");
    });

    test("rejects above max", () => {
      expect(() => validateOffset(9976)).toThrow("Offset must be 0-9975");
    });

    test("rejects NaN", () => {
      expect(() => validateOffset(Number.NaN)).toThrow("Offset must be 0-9975");
    });
  });

  describe("validateMutuallyExclusive", () => {
    test("passes when no keys are present", () => {
      expect(() =>
        validateMutuallyExclusive({}, ["a", "b", "c"], "error")
      ).not.toThrow();
    });

    test("passes when one key is present", () => {
      expect(() =>
        validateMutuallyExclusive({ a: "val" }, ["a", "b", "c"], "error")
      ).not.toThrow();
    });

    test("throws when two keys are present", () => {
      expect(() =>
        validateMutuallyExclusive(
          { a: "val", b: "val" },
          ["a", "b", "c"],
          "mutually exclusive"
        )
      ).toThrow("mutually exclusive");
    });

    test("throws when all keys are present", () => {
      expect(() =>
        validateMutuallyExclusive(
          { a: 1, b: 2, c: 3 },
          ["a", "b", "c"],
          "error"
        )
      ).toThrow("error");
    });

    test("ignores falsy values", () => {
      expect(() =>
        validateMutuallyExclusive(
          { a: "val", b: undefined, c: "" },
          ["a", "b", "c"],
          "error"
        )
      ).not.toThrow();
    });
  });

  describe("validateRequired", () => {
    test("passes for truthy value", () => {
      expect(() => validateRequired("hello", "required")).not.toThrow();
    });

    test("passes for non-empty object", () => {
      expect(() => validateRequired({ key: "val" }, "required")).not.toThrow();
    });

    test("throws for undefined", () => {
      expect(() => validateRequired(undefined, "value required")).toThrow(
        "value required"
      );
    });

    test("throws for null", () => {
      expect(() => validateRequired(null, "value required")).toThrow(
        "value required"
      );
    });

    test("throws for empty string", () => {
      expect(() => validateRequired("", "value required")).toThrow(
        "value required"
      );
    });
  });

  describe("validateEnum", () => {
    const allowed = new Set(["a", "b", "c"]);

    test("passes for valid value", () => {
      expect(() => validateEnum("a", allowed, "invalid")).not.toThrow();
    });

    test("throws for invalid value", () => {
      expect(() => validateEnum("d", allowed, "invalid value")).toThrow(
        "invalid value"
      );
    });
  });

  describe("validateSearchFilters", () => {
    test("passes with content", () => {
      expect(() =>
        validateSearchFilters({
          content: "hello",
          authorIds: [],
          channelIds: [],
        })
      ).not.toThrow();
    });

    test("passes with authorIds", () => {
      expect(() =>
        validateSearchFilters({
          authorIds: ["user-1"],
          channelIds: [],
        })
      ).not.toThrow();
    });

    test("passes with authorType", () => {
      expect(() =>
        validateSearchFilters({
          authorIds: [],
          authorType: "bot",
          channelIds: [],
        })
      ).not.toThrow();
    });

    test("passes with channelIds", () => {
      expect(() =>
        validateSearchFilters({
          authorIds: [],
          channelIds: ["ch-1"],
        })
      ).not.toThrow();
    });

    test("passes with has", () => {
      expect(() =>
        validateSearchFilters({
          authorIds: [],
          channelIds: [],
          has: "link",
        })
      ).not.toThrow();
    });

    test("throws when no filters provided", () => {
      expect(() =>
        validateSearchFilters({
          authorIds: [],
          channelIds: [],
        })
      ).toThrow("Search requires at least one filter");
    });

    test("throws when content is empty string", () => {
      expect(() =>
        validateSearchFilters({
          content: "",
          authorIds: [],
          channelIds: [],
        })
      ).toThrow("Search requires at least one filter");
    });
  });

  describe("VALID_HAS_VALUES", () => {
    test("contains all expected values", () => {
      expect(VALID_HAS_VALUES.has("link")).toBe(true);
      expect(VALID_HAS_VALUES.has("embed")).toBe(true);
      expect(VALID_HAS_VALUES.has("file")).toBe(true);
      expect(VALID_HAS_VALUES.has("video")).toBe(true);
      expect(VALID_HAS_VALUES.has("image")).toBe(true);
      expect(VALID_HAS_VALUES.has("sound")).toBe(true);
    });

    test("rejects invalid values", () => {
      expect(VALID_HAS_VALUES.has("sticker")).toBe(false);
    });
  });

  describe("VALID_AUTHOR_TYPES", () => {
    test("contains user and bot", () => {
      expect(VALID_AUTHOR_TYPES.has("user")).toBe(true);
      expect(VALID_AUTHOR_TYPES.has("bot")).toBe(true);
    });

    test("rejects invalid values", () => {
      expect(VALID_AUTHOR_TYPES.has("webhook")).toBe(false);
    });
  });
});
