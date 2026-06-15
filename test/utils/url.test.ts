import { expect, test } from "bun:test";
import { cleanUrl } from "../../src/utils/url.js";

test("keeps a url that only has the v param", () => {
  expect(cleanUrl("https://www.youtube.com/watch?v=abc123")).toBe(
    "https://www.youtube.com/watch?v=abc123",
  );
});

test("leaves a url with no query params unchanged", () => {
  expect(cleanUrl("https://example.com/path")).toBe("https://example.com/path");
});

test("returns the original input when it is not a valid url", () => {
  expect(cleanUrl("not a url")).toBe("not a url");
});

test("strips every query param except the youtube video id", () => {
  expect(
    cleanUrl("https://www.youtube.com/watch?v=abc123&list=xyz&index=2"),
  ).toBe("https://www.youtube.com/watch?v=abc123");
});

test("removes all tracking params from a non-youtube url", () => {
  expect(cleanUrl("https://example.com/?utm_source=foo&bar=baz")).toBe(
    "https://example.com/",
  );
});
