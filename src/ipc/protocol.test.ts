import { describe, expect, test } from "bun:test";
import { ConnectionRefusedError } from "./protocol";

describe("ConnectionRefusedError", () => {
  test("is instanceof Error", () => {
    const err = new ConnectionRefusedError();
    expect(err).toBeInstanceOf(Error);
  });

  test("has default message", () => {
    const err = new ConnectionRefusedError();
    expect(err.message).toBe("Connection refused");
  });

  test("accepts custom message", () => {
    const err = new ConnectionRefusedError("socket not found");
    expect(err.message).toBe("socket not found");
  });

  test("has name ConnectionRefusedError", () => {
    const err = new ConnectionRefusedError();
    expect(err.name).toBe("ConnectionRefusedError");
  });
});
