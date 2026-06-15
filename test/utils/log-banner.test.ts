import { afterEach, expect, test } from "bun:test";
import logBanner from "../../src/utils/log-banner.js";

// logBanner reads the real package.json (via read-pkg) and logs at info level,
// which is silent under test. We assert the two env-driven branches run cleanly.

const saved = {
  buildDate: process.env["BUILD_DATE"],
  commit: process.env["COMMIT_HASH"],
};

afterEach(() => {
  for (const [key, value] of [
    ["BUILD_DATE", saved.buildDate],
    ["COMMIT_HASH", saved.commit],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("logs the banner without a build date or commit hash", () => {
  delete process.env["BUILD_DATE"];
  delete process.env["COMMIT_HASH"];
  expect(() => logBanner()).not.toThrow();
});

test("logs the banner with a build date and commit hash", () => {
  process.env["BUILD_DATE"] = "2026-01-01T00:00:00Z";
  process.env["COMMIT_HASH"] = "abc1234";
  expect(() => logBanner()).not.toThrow();
});
