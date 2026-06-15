import { expect, mock, test } from "bun:test";
import ForwardSeek from "../../src/commands/fseek.js";
import Replay from "../../src/commands/replay.js";
import Seek from "../../src/commands/seek.js";
import { fakeInteraction, fakeManager } from "../helpers/discord.js";

const playing = (overrides: Record<string, unknown> = {}) => ({
  getCurrent: () => ({ isLive: false, length: 200 }),
  getPosition: () => 0,
  seek: mock(async () => {}),
  forwardSeek: mock(async () => {}),
  ...overrides,
});

test("replay: seeks to the start of the current song", async () => {
  const player = playing();
  const cmd = new Replay(fakeManager(player));
  const { interaction, replies } = fakeInteraction();

  await cmd.execute(interaction);

  expect(player.seek).toHaveBeenCalledWith(0);
  expect(replies[0]).toContain("replayed");
});

test("replay: throws when nothing is playing", async () => {
  const cmd = new Replay(fakeManager(playing({ getCurrent: () => null })));
  const { interaction } = fakeInteraction();

  expect(cmd.execute(interaction)).rejects.toThrow("nothing is playing");
});

test("replay: throws for a livestream", async () => {
  const cmd = new Replay(
    fakeManager(playing({ getCurrent: () => ({ isLive: true, length: 0 }) })),
  );
  const { interaction } = fakeInteraction();

  expect(cmd.execute(interaction)).rejects.toThrow("can't replay a livestream");
});

test("seek: parses a colon timestamp and seeks", async () => {
  const player = playing({ getPosition: () => 90 });
  const cmd = new Seek(fakeManager(player));
  const { interaction, replies } = fakeInteraction({
    strings: { time: "1:30" },
  });

  await cmd.execute(interaction);

  expect(player.seek).toHaveBeenCalledWith(90);
  expect(replies[0]).toContain("01:30");
});

test("seek: parses a duration string and seeks", async () => {
  const player = playing({ getPosition: () => 30 });
  const cmd = new Seek(fakeManager(player));
  const { interaction } = fakeInteraction({ strings: { time: "30" } });

  await cmd.execute(interaction);

  expect(player.seek).toHaveBeenCalledWith(30);
});

test("seek: throws when seeking past the end", async () => {
  const cmd = new Seek(fakeManager(playing()));
  const { interaction } = fakeInteraction({ strings: { time: "500" } });

  expect(cmd.execute(interaction)).rejects.toThrow("past the end");
});

test("seek: throws when nothing is playing", async () => {
  const cmd = new Seek(fakeManager(playing({ getCurrent: () => null })));
  const { interaction } = fakeInteraction({ strings: { time: "10" } });

  expect(cmd.execute(interaction)).rejects.toThrow("nothing is playing");
});

test("seek: throws for a livestream", async () => {
  const cmd = new Seek(
    fakeManager(playing({ getCurrent: () => ({ isLive: true, length: 0 }) })),
  );
  const { interaction } = fakeInteraction({ strings: { time: "10" } });

  expect(cmd.execute(interaction)).rejects.toThrow(
    "can't seek in a livestream",
  );
});

test("fseek: seeks forward by a duration", async () => {
  const player = playing({ getPosition: () => 40 });
  const cmd = new ForwardSeek(fakeManager(player));
  const { interaction, replies } = fakeInteraction({ strings: { time: "30" } });

  await cmd.execute(interaction);

  expect(player.forwardSeek).toHaveBeenCalledWith(30);
  expect(replies[0]).toContain("seeked to");
});

test("fseek: throws when the seek value is missing", async () => {
  const cmd = new ForwardSeek(fakeManager(playing()));
  const { interaction } = fakeInteraction();

  expect(cmd.execute(interaction)).rejects.toThrow("missing seek value");
});

test("fseek: throws when seeking past the end", async () => {
  const cmd = new ForwardSeek(fakeManager(playing({ getPosition: () => 190 })));
  const { interaction } = fakeInteraction({ strings: { time: "30" } });

  expect(cmd.execute(interaction)).rejects.toThrow("past the end");
});

test("fseek: throws when nothing is playing", async () => {
  const cmd = new ForwardSeek(fakeManager(playing({ getCurrent: () => null })));
  const { interaction } = fakeInteraction({ strings: { time: "10" } });

  expect(cmd.execute(interaction)).rejects.toThrow("nothing is playing");
});
