import { expect, mock, test } from "bun:test";

// The function makes a single got() request and returns the suggestions array
// (the second element of the Firefox-style autocomplete response). The mock is
// kept "complete" (with .extend) so that, should it leak to other files via
// bun's shared module registry, it doesn't break their got.extend() calls.
let response: [string, string[]] = ["", []];
const fakeGot = () => ({ json: async () => response });
fakeGot.extend = () => fakeGot;
mock.module("got", () => ({ default: fakeGot }));

const { default: getYouTubeSuggestionsFor } = await import(
  "../../src/utils/get-youtube-suggestions-for.js"
);

test("returns the suggestions array from the response", async () => {
  response = ["query", ["first", "second"]];
  expect(await getYouTubeSuggestionsFor("query")).toEqual(["first", "second"]);
});

test("returns an empty list when there are no suggestions", async () => {
  response = ["query", []];
  expect(await getYouTubeSuggestionsFor("query")).toEqual([]);
});
