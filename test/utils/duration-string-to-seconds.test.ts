import { expect, test } from "bun:test";
import durationStringToSeconds from "../../src/utils/duration-string-to-seconds.js";

test("treats a bare number as seconds", () => {
  expect(durationStringToSeconds("90")).toBe(90);
});

test("parses a minutes suffix", () => {
  expect(durationStringToSeconds("1m")).toBe(60);
});

test("parses a compound duration", () => {
  expect(durationStringToSeconds("1hr 30s")).toBe(3630);
});

test("parses an hours suffix", () => {
  expect(durationStringToSeconds("2h")).toBe(7200);
});

test("returns 0 for an unparseable string", () => {
  expect(durationStringToSeconds("garbage")).toBe(0);
});

test("parses a unit-prefixed value that ends in digits", () => {
  // Regression: "1m30" used to match /\d+$/ and parseInt truncated it to 1.
  // It is now parsed as a duration (1 minute 30 seconds).
  expect(durationStringToSeconds("1m30")).toBe(90);
});

test("does not return NaN for a malformed digit-terminated string", () => {
  expect(durationStringToSeconds("abc120")).not.toBeNaN();
});
