import { expect, test } from "bun:test";
import {
  ONE_HOUR_IN_SECONDS,
  ONE_MINUTE_IN_SECONDS,
} from "../../src/utils/constants.js";

test("one minute is 60 seconds", () => {
  expect(ONE_MINUTE_IN_SECONDS).toBe(60);
});

test("one hour is 3600 seconds", () => {
  expect(ONE_HOUR_IN_SECONDS).toBe(3600);
});

test("one hour is sixty minutes", () => {
  expect(ONE_HOUR_IN_SECONDS).toBe(ONE_MINUTE_IN_SECONDS * 60);
});
