import { expect, test } from "bun:test";
import getProgressBar from "../../src/utils/get-progress-bar.js";

test("places the dot at the start for zero progress", () => {
  expect(getProgressBar(5, 0)).toBe("🔘▬▬▬▬");
});

test("places the dot in the middle for half progress", () => {
  expect(getProgressBar(4, 0.5)).toBe("▬▬🔘▬");
});

test("the bar has exactly `width` segments", () => {
  expect([...getProgressBar(10, 0.3)]).toHaveLength(10);
});

test("full progress pushes the dot off the end (no dot rendered)", () => {
  expect(getProgressBar(3, 1)).toBe("▬▬▬");
});

test("a zero-width bar is an empty string", () => {
  expect(getProgressBar(0, 0.5)).toBe("");
});
