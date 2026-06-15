import { expect, test } from "bun:test";
import type { REST } from "@discordjs/rest";
import registerCommandsOnGuild from "../../src/utils/register-commands-on-guild.js";

type PutCall = [string, { body: unknown[] }];

const makeRest = (calls: PutCall[]) =>
  ({
    put: async (route: string, options: { body: unknown[] }) => {
      calls.push([route, options]);
    },
  }) as unknown as REST;

const command = (name: string) =>
  ({ toJSON: () => ({ name }) }) as unknown as never;

test("puts serialized commands to the guild commands route", async () => {
  const calls: PutCall[] = [];
  await registerCommandsOnGuild({
    rest: makeRest(calls),
    applicationId: "app-1",
    guildId: "guild-1",
    commands: [command("play"), command("stop")],
  });

  expect(calls).toHaveLength(1);
  const [route, options] = calls[0] as PutCall;
  expect(route).toContain("app-1");
  expect(route).toContain("guild-1");
  expect(options.body).toEqual([{ name: "play" }, { name: "stop" }]);
});

test("sends an empty body when there are no commands", async () => {
  const calls: PutCall[] = [];
  await registerCommandsOnGuild({
    rest: makeRest(calls),
    applicationId: "app-2",
    guildId: "guild-2",
    commands: [],
  });

  expect((calls[0] as PutCall)[1].body).toEqual([]);
});
