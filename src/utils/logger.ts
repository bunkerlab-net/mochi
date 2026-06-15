import { ecsFormat } from "@elastic/ecs-pino-format";
import pino, { type Logger } from "pino";
import pretty from "pino-pretty";

type LogFormat = "plain" | "json" | "ecs";

const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
] as const;

interface Resolved<T> {
  value: T;
  warning?: string;
}

/**
 * Resolve LOG_FORMAT (case-insensitive). Defaults to "plain"; an unrecognized
 * value falls back to "plain" with a deferred warning rather than throwing, so
 * a typo can never block startup.
 */
export const resolveLogFormat = (): Resolved<LogFormat> => {
  const raw = process.env["LOG_FORMAT"];
  if (raw === undefined || raw === "") {
    return { value: "plain" };
  }

  const normalized = raw.toLowerCase();
  if (normalized === "plain" || normalized === "json" || normalized === "ecs") {
    return { value: normalized };
  }

  return {
    value: "plain",
    warning: `Invalid LOG_FORMAT "${raw}". Expected "plain", "json", or "ecs". Defaulting to "plain".`,
  };
};

/**
 * Resolve LOG_LEVEL (case-insensitive). Defaults to "info" — or "silent" under
 * test — and falls back to "info" with a deferred warning on an unknown value,
 * since pino throws on an invalid level at construction.
 */
export const resolveLogLevel = (): Resolved<string> => {
  const raw = process.env["LOG_LEVEL"];
  if (raw === undefined || raw === "") {
    return { value: process.env["NODE_ENV"] === "test" ? "silent" : "info" };
  }

  const normalized = raw.toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(normalized)) {
    return { value: normalized };
  }

  return {
    value: "info",
    warning: `Invalid LOG_LEVEL "${raw}". Expected one of ${LOG_LEVELS.join(", ")}. Defaulting to "info".`,
  };
};

export const buildRootLogger = (format: LogFormat, level: string): Logger => {
  if (format === "ecs") {
    return pino({ ...ecsFormat(), level });
  }

  if (format === "json") {
    return pino({ level });
  }

  // plain: human-readable lines via an in-process pino-pretty stream. Avoiding
  // pino's worker-thread transport keeps logging working under the bundled
  // single-file runtime, where the transport target can't be resolved.
  return pino(
    { level },
    pretty({
      translateTime: "SYS:standard",
      ignore: "pid,hostname,component",
      messageFormat: "[{component}] {msg}",
    }),
  );
};

let rootLogger: Logger | undefined;

/**
 * Build the root logger on first use rather than at import. Mochi loads env
 * from a file via dotenv during startup, and module import order can't be
 * relied on to run that before this module — deferring construction guarantees
 * LOG_FORMAT/LOG_LEVEL are read after the env is in place.
 */
const getRoot = (): Logger => {
  if (rootLogger) {
    return rootLogger;
  }

  const format = resolveLogFormat();
  const level = resolveLogLevel();
  rootLogger = buildRootLogger(format.value, level.value);

  // Surface any configuration we had to fall back on now that the logger
  // exists — resolution can't log where a bad value is detected.
  for (const { warning } of [format, level]) {
    if (warning) {
      rootLogger.child({ component: "logger" }).warn(warning);
    }
  }

  return rootLogger;
};

const children = new Map<string, Logger>();

const child = (namespace: string): Logger => {
  const existing = children.get(namespace);
  if (existing) {
    return existing;
  }

  const instance = getRoot().child({ component: namespace });
  children.set(namespace, instance);
  return instance;
};

type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const emit = (level: Level, namespace: string, args: unknown[]): void => {
  const target = child(namespace);
  (target[level] as (...rest: unknown[]) => void).apply(target, args);
};

/**
 * Leveled, namespaced logger backed by pino.
 *
 * `info`/`warn`/`error` (and `fatal`) print at the default level, so
 * operational events and failures surface in production logs without any
 * opt-in. `debug`/`trace` are verbose detail, hidden unless `LOG_LEVEL=debug`
 * (or `trace`). The namespace becomes pino's `component` field. Output format
 * is controlled by `LOG_FORMAT` (`plain` default, `json`, or `ecs`).
 */
const logger = {
  trace: (namespace: string, ...args: unknown[]) =>
    emit("trace", namespace, args),
  debug: (namespace: string, ...args: unknown[]) =>
    emit("debug", namespace, args),
  info: (namespace: string, ...args: unknown[]) =>
    emit("info", namespace, args),
  warn: (namespace: string, ...args: unknown[]) =>
    emit("warn", namespace, args),
  error: (namespace: string, ...args: unknown[]) =>
    emit("error", namespace, args),
  fatal: (namespace: string, ...args: unknown[]) =>
    emit("fatal", namespace, args),
};

export default logger;
