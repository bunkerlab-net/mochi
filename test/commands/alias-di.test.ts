import { expect, test } from "bun:test";
import type Command from "../../src/commands/index.js";
import container from "../../src/inversify.config.js";
import { TYPES } from "../../src/types.js";

// Alias commands (e.g. /summon extends Join, /next extends Skip) must still get
// their constructor dependencies injected when resolved through the DI
// container. A subclass that only overrides a field generates an implicit
// zero-arg constructor, so inversify injects nothing unless the alias declares
// its own injected constructor. Constructing the command directly in a unit
// test hides this, so resolve it the way the bot actually does.
const commands = container.getAll<Command>(TYPES.Command);

const withPlayerManager = (name: string) => {
  const command = commands.find((c) => c.slashCommand.name === name) as
    | (Command & { playerManager?: unknown })
    | undefined;
  expect(command, `command /${name} is not registered`).toBeDefined();
  return command;
};

test.each([
  ["join"],
  ["summon"],
  ["skip"],
  ["next"],
])("/%s resolves its injected playerManager via DI", (name) => {
  expect(withPlayerManager(name)?.playerManager).toBeDefined();
});
