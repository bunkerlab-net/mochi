import { expect, test } from "bun:test";
import {
  CONFIG_SETTINGS,
  CONFIG_SETTINGS_BY_KEY,
  describeAllowedValues,
  formatSettingValue,
  parseSettingValue,
  type SettingDefinition,
} from "../../src/utils/config-settings.js";

const byKey = (key: string): SettingDefinition => {
  const definition = CONFIG_SETTINGS_BY_KEY[key];
  if (!definition) {
    throw new Error(`no fixture setting for ${key}`);
  }
  return definition;
};

test("every setting has a unique key and a registered lookup", () => {
  const keys = CONFIG_SETTINGS.map((definition) => definition.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const definition of CONFIG_SETTINGS) {
    expect(CONFIG_SETTINGS_BY_KEY[definition.key]).toBe(definition);
  }
});

test("parseSettingValue accepts friendly boolean spellings", () => {
  const definition = byKey("autoplay");
  for (const truthy of ["true", "Yes", "ON", "1", "enable", "enabled"]) {
    expect(parseSettingValue(definition, truthy)).toBe(true);
  }
  for (const falsy of ["false", "No", "off", "0", "disable", "disabled"]) {
    expect(parseSettingValue(definition, falsy)).toBe(false);
  }
});

test("parseSettingValue rejects a non-boolean for a boolean setting", () => {
  expect(() => parseSettingValue(byKey("autoplay"), "maybe")).toThrow(
    "true or false",
  );
});

test("parseSettingValue parses and range-checks integers", () => {
  expect(parseSettingValue(byKey("default-volume"), " 80 ")).toBe(80);
  expect(() => parseSettingValue(byKey("default-volume"), "loud")).toThrow(
    "whole number",
  );
  expect(() => parseSettingValue(byKey("default-volume"), "101")).toThrow(
    "at most 100",
  );
  expect(() => parseSettingValue(byKey("playlist-limit"), "0")).toThrow(
    "at least 1",
  );
});

test("parseSettingValue allows 0 for the never-leave wait setting", () => {
  expect(parseSettingValue(byKey("wait-after-queue-empties"), "0")).toBe(0);
});

test("parseSettingValue accepts any integer when unbounded", () => {
  const unbounded: SettingDefinition = {
    key: "x",
    label: "X",
    column: "defaultVolume",
    type: "integer",
    description: "",
  };
  expect(parseSettingValue(unbounded, "-42")).toBe(-42);
});

test("formatSettingValue renders booleans, ints, and the wait special case", () => {
  expect(formatSettingValue(byKey("autoplay"), true)).toBe("yes");
  expect(formatSettingValue(byKey("autoplay"), false)).toBe("no");
  expect(formatSettingValue(byKey("default-volume"), 100)).toBe("100");
  expect(formatSettingValue(byKey("wait-after-queue-empties"), 0)).toBe(
    "never leave",
  );
  expect(formatSettingValue(byKey("wait-after-queue-empties"), 30)).toBe("30s");
});

test("describeAllowedValues summarizes each value type", () => {
  expect(describeAllowedValues(byKey("autoplay"))).toBe("true or false");
  expect(describeAllowedValues(byKey("default-volume"))).toBe(
    "a whole number from 0 to 100",
  );
  expect(describeAllowedValues(byKey("playlist-limit"))).toBe(
    "a whole number ≥ 1",
  );

  const maxOnly: SettingDefinition = {
    key: "x",
    label: "X",
    column: "defaultVolume",
    type: "integer",
    max: 5,
    description: "",
  };
  expect(describeAllowedValues(maxOnly)).toBe("a whole number ≤ 5");

  const unbounded: SettingDefinition = {
    key: "y",
    label: "Y",
    column: "defaultVolume",
    type: "integer",
    description: "",
  };
  expect(describeAllowedValues(unbounded)).toBe("a whole number");
});
