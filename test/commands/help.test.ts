import { expect, test } from "bun:test";
import { type EmbedBuilder, MessageFlags } from "discord.js";
import { fakeInteraction } from "../helpers/discord.js";

// Import inversify.config before help.js: the two are circular (config binds the
// Help command), so loading help first would hit a TDZ on the Help binding.
// Dynamic imports keep that order, whereas static imports get reordered.
await import("../../src/inversify.config.js");
const { default: HelpCmd } = await import("../../src/commands/help.js");

test("lists registered commands alphabetically in an ephemeral embed", async () => {
  const { interaction, replyPayloads } = fakeInteraction();
  await new HelpCmd().execute(interaction);

  expect(replyPayloads).toHaveLength(1);
  const payload = replyPayloads[0] as { embeds: EmbedBuilder[]; flags: number };
  expect(payload.flags).toBe(MessageFlags.Ephemeral);

  const description = payload.embeds[0]?.data.description ?? "";
  // A representative spread of real commands, including /help itself.
  expect(description).toContain("**/config** —");
  expect(description).toContain("**/help** —");
  expect(description).toContain("**/play** —");
  // Sorted alphabetically: /config precedes /play.
  expect(description.indexOf("**/config**")).toBeLessThan(
    description.indexOf("**/play**"),
  );
});
