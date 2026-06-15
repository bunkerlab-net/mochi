import { expect, test } from "bun:test";
import { parseTime, prettyTime } from "../../src/utils/time.js";

test("prettyTime: formats sub-minute durations as MM:SS", () => {
  expect(prettyTime(5)).toBe("00:05");
});

test("prettyTime: formats minutes and seconds", () => {
  expect(prettyTime(125)).toBe("02:05");
});

test("prettyTime: includes hours when the duration is at least an hour", () => {
  expect(prettyTime(3661)).toBe("01:01:01");
});

test("prettyTime: formats zero as 00:00", () => {
  expect(prettyTime(0)).toBe("00:00");
});

test("prettyTime: handles exactly one hour", () => {
  expect(prettyTime(3600)).toBe("01:00:00");
});

test("parseTime: parses MM:SS into seconds", () => {
  expect(parseTime("02:05")).toBe(125);
});

test("parseTime: parses HH:MM:SS into seconds", () => {
  expect(parseTime("01:01:01")).toBe(3661);
});

test("parseTime: parses a bare seconds value", () => {
  expect(parseTime("42")).toBe(42);
});

test("parseTime and prettyTime round-trip", () => {
  expect(prettyTime(parseTime("01:23:45"))).toBe("01:23:45");
});
