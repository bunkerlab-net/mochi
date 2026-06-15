import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  buildRootLogger,
  resolveLogFormat,
  resolveLogLevel,
} from "../../src/utils/logger.js";

// These helpers read process.env when called, so each branch is reachable by
// setting the relevant variable. The module-level logger is memoized at import,
// so this is the only way to exercise the format/level resolution branches.

let savedFormat: string | undefined;
let savedLevel: string | undefined;

beforeEach(() => {
  savedFormat = process.env["LOG_FORMAT"];
  savedLevel = process.env["LOG_LEVEL"];
});

afterEach(() => {
  if (savedFormat === undefined) {
    delete process.env["LOG_FORMAT"];
  } else {
    process.env["LOG_FORMAT"] = savedFormat;
  }
  if (savedLevel === undefined) {
    delete process.env["LOG_LEVEL"];
  } else {
    process.env["LOG_LEVEL"] = savedLevel;
  }
});

test("resolveLogFormat: defaults to plain when unset", () => {
  delete process.env["LOG_FORMAT"];
  expect(resolveLogFormat()).toEqual({ value: "plain" });
});

test("resolveLogFormat: defaults to plain for an empty string", () => {
  process.env["LOG_FORMAT"] = "";
  expect(resolveLogFormat()).toEqual({ value: "plain" });
});

test("resolveLogFormat: accepts json and ecs case-insensitively", () => {
  process.env["LOG_FORMAT"] = "JSON";
  expect(resolveLogFormat()).toEqual({ value: "json" });
  process.env["LOG_FORMAT"] = "Ecs";
  expect(resolveLogFormat()).toEqual({ value: "ecs" });
});

test("resolveLogFormat: falls back to plain with a warning on a bad value", () => {
  process.env["LOG_FORMAT"] = "yaml";
  const result = resolveLogFormat();
  expect(result.value).toBe("plain");
  expect(result.warning).toContain("Invalid LOG_FORMAT");
});

test("resolveLogLevel: defaults to info when unset and not under test env", () => {
  delete process.env["LOG_LEVEL"];
  const savedNodeEnv = process.env["NODE_ENV"];
  delete process.env["NODE_ENV"];
  expect(resolveLogLevel()).toEqual({ value: "info" });
  if (savedNodeEnv !== undefined) {
    process.env["NODE_ENV"] = savedNodeEnv;
  }
});

test("resolveLogLevel: defaults to silent under NODE_ENV=test", () => {
  delete process.env["LOG_LEVEL"];
  const savedNodeEnv = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "test";
  expect(resolveLogLevel()).toEqual({ value: "silent" });
  if (savedNodeEnv === undefined) {
    delete process.env["NODE_ENV"];
  } else {
    process.env["NODE_ENV"] = savedNodeEnv;
  }
});

test("resolveLogLevel: accepts a valid level case-insensitively", () => {
  process.env["LOG_LEVEL"] = "DEBUG";
  expect(resolveLogLevel()).toEqual({ value: "debug" });
});

test("resolveLogLevel: falls back to info with a warning on a bad value", () => {
  process.env["LOG_LEVEL"] = "loud";
  const result = resolveLogLevel();
  expect(result.value).toBe("info");
  expect(result.warning).toContain("Invalid LOG_LEVEL");
});

test("buildRootLogger: builds a logger for each supported format", () => {
  expect(buildRootLogger("json", "silent").level).toBe("silent");
  expect(buildRootLogger("ecs", "info").level).toBe("info");
  expect(buildRootLogger("plain", "warn").level).toBe("warn");
});
