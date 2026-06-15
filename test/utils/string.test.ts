import { expect, test } from "bun:test";
import { truncate } from "../../src/utils/string.js";

test("truncate: leaves short strings untouched", () => {
  expect(truncate("hello", 50)).toBe("hello");
});

test("truncate: leaves a string exactly at the limit untouched", () => {
  const text = "a".repeat(50);
  expect(truncate(text)).toBe(text);
});

test("truncate: shortens an over-long string and appends an ellipsis", () => {
  const result = truncate("a".repeat(60), 10);
  expect(result).toBe(`${"a".repeat(7)}...`);
  expect(result).toHaveLength(10);
});

test("truncate: uses the default maxLength of 50", () => {
  const result = truncate("b".repeat(100));
  expect(result).toHaveLength(50);
  expect(result.endsWith("...")).toBe(true);
});

test("truncate: handles an empty string", () => {
  expect(truncate("", 5)).toBe("");
});
