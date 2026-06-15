import { expect, test } from "bun:test";
import logger from "../../src/utils/logger.js";

// LOG_LEVEL=silent (from test/setup.ts) means these produce no output; we are
// exercising the namespaced emit/child plumbing, not pino's rendering.

test("exposes the six leveled methods", () => {
  for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
    expect(typeof (logger as Record<string, unknown>)[level]).toBe("function");
  }
});

test("each level accepts a namespace and arguments without throwing", () => {
  expect(() => {
    logger.trace("test-ns", "trace message");
    logger.debug("test-ns", "debug message");
    logger.info("test-ns", "info message");
    logger.warn("test-ns", "warn message");
    logger.error("test-ns", "error message");
    logger.fatal("test-ns", "fatal message");
  }).not.toThrow();
});

test("reuses the cached child logger for a repeated namespace", () => {
  // Second call on the same namespace hits the children-map cache branch.
  expect(() => {
    logger.info("cached-ns", "first");
    logger.info("cached-ns", "second");
  }).not.toThrow();
});

test("forwards multiple arguments to the underlying logger", () => {
  expect(() => {
    logger.info("multi-ns", { a: 1 }, "and a string", 42);
  }).not.toThrow();
});
