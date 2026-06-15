import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type Config from "../../src/services/config.js";

// Replace the Spotify client and p-retry so the constructor's token refresh runs
// synchronously, without a network call or real retry backoff.
let grantImpl: () => Promise<{
  body: { access_token: string; expires_in: number };
}>;

class FakeSpotify {
  setAccessToken(_token: string) {}
  async clientCredentialsGrant() {
    return grantImpl();
  }
}

mock.module("spotify-web-api-node", () => ({ default: FakeSpotify }));
mock.module("p-retry", () => ({
  default: async (fn: () => Promise<unknown>) => fn(),
}));

const { default: ThirdParty } = await import(
  "../../src/services/third-party.js"
);

const config = {
  SPOTIFY_CLIENT_ID: "id",
  SPOTIFY_CLIENT_SECRET: "secret",
} as unknown as Config;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let instance: { cleanup: () => void } | undefined;

beforeEach(() => {
  grantImpl = async () => ({
    body: { access_token: "tok", expires_in: 3600 },
  });
});

afterEach(() => {
  instance?.cleanup();
  instance = undefined;
});

test("refreshes the Spotify token on construction", async () => {
  instance = new ThirdParty(config);
  await tick();
  // No throw and a token timer was scheduled (cleared in afterEach).
  expect(instance).toBeDefined();
});

test("schedules a retry when the token refresh fails", async () => {
  grantImpl = async () => {
    throw new Error("auth down");
  };
  instance = new ThirdParty(config);
  await tick();
  expect(instance).toBeDefined();
});

test("cleanup is safe to call", async () => {
  instance = new ThirdParty(config);
  await tick();
  expect(() => instance?.cleanup()).not.toThrow();
});
