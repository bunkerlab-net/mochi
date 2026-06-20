import { expect, test } from "bun:test";
import errorMsg from "../../src/utils/error-msg.js";

test("returns a generic message when given nothing", () => {
  expect(errorMsg()).toBe("unknown error");
});

test("wraps a string error", () => {
  expect(errorMsg("boom")).toBe("🚫 aiya: boom");
});

test("unwraps an Error instance's message", () => {
  expect(errorMsg(new Error("kaboom"))).toBe("🚫 aiya: kaboom");
});

test("an empty string is treated as falsy and yields the generic message", () => {
  expect(errorMsg("")).toBe("unknown error");
});
