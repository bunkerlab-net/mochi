import { expect, test } from "bun:test";
import { chunk } from "../../src/utils/arrays.js";

test("chunk: splits an array into chunks of the given length", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});

test("chunk: returns a single chunk when len exceeds array length", () => {
  expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
});

test("chunk: returns an empty array for an empty input", () => {
  expect(chunk([], 3)).toEqual([]);
});

test("chunk: produces exact even chunks when divisible", () => {
  expect(chunk(["a", "b", "c", "d"], 2)).toEqual([
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("chunk: a chunk size of 1 yields one element per chunk", () => {
  expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
});
