import { expect, mock, test } from "bun:test";
import Clear from "../../src/commands/clear.js";
import Move from "../../src/commands/move.js";
import Remove from "../../src/commands/remove.js";
import Shuffle from "../../src/commands/shuffle.js";
import { fakeInteraction, fakeManager } from "../helpers/discord.js";

test("clear: empties the queue and confirms", async () => {
  const clear = mock(() => {});
  const cmd = new Clear(fakeManager({ clear }));
  const { interaction, replies } = fakeInteraction();

  await cmd.execute(interaction);

  expect(clear).toHaveBeenCalled();
  expect(replies[0]).toContain("rice paddy");
});

test("shuffle: shuffles a non-empty queue", async () => {
  const shuffle = mock(() => {});
  const cmd = new Shuffle(fakeManager({ isQueueEmpty: () => false, shuffle }));
  const { interaction, replies } = fakeInteraction();

  await cmd.execute(interaction);

  expect(shuffle).toHaveBeenCalled();
  expect(replies[0]).toBe("shuffled");
});

test("shuffle: throws when the queue is empty", async () => {
  const cmd = new Shuffle(
    fakeManager({ isQueueEmpty: () => true, shuffle: () => {} }),
  );
  const { interaction } = fakeInteraction();

  expect(cmd.execute(interaction)).rejects.toThrow("not enough songs");
});

test("move: moves a song and reports the new position", async () => {
  const move = mock(() => ({ title: "My Song" }));
  const cmd = new Move(fakeManager({ move }));
  const { interaction, replies } = fakeInteraction({
    integers: { from: 2, to: 5 },
  });

  await cmd.execute(interaction);

  expect(move).toHaveBeenCalledWith(2, 5);
  expect(replies[0]).toContain("My Song");
  expect(replies[0]).toContain("5");
});

test("move: defaults missing positions to 1", async () => {
  const move = mock(() => ({ title: "x" }));
  const cmd = new Move(fakeManager({ move }));
  const { interaction } = fakeInteraction();

  await cmd.execute(interaction);

  expect(move).toHaveBeenCalledWith(1, 1);
});

test("move: rejects a from-position below 1", async () => {
  const cmd = new Move(fakeManager({ move: () => ({ title: "x" }) }));
  const { interaction } = fakeInteraction({ integers: { from: 0, to: 1 } });

  expect(cmd.execute(interaction)).rejects.toThrow("at least 1");
});

test("move: rejects a to-position below 1", async () => {
  const cmd = new Move(fakeManager({ move: () => ({ title: "x" }) }));
  const { interaction } = fakeInteraction({ integers: { from: 1, to: 0 } });

  expect(cmd.execute(interaction)).rejects.toThrow("at least 1");
});

test("remove: removes songs and confirms", async () => {
  const removeFromQueue = mock(() => {});
  const cmd = new Remove(fakeManager({ removeFromQueue }));
  const { interaction, replies } = fakeInteraction({
    integers: { position: 3, range: 2 },
  });

  await cmd.execute(interaction);

  expect(removeFromQueue).toHaveBeenCalledWith(3, 2);
  expect(replies[0]).toContain("removed");
});

test("remove: rejects a position below 1", async () => {
  const cmd = new Remove(fakeManager({ removeFromQueue: () => {} }));
  const { interaction } = fakeInteraction({ integers: { position: 0 } });

  expect(cmd.execute(interaction)).rejects.toThrow(
    "position must be at least 1",
  );
});

test("remove: rejects a range below 1", async () => {
  const cmd = new Remove(fakeManager({ removeFromQueue: () => {} }));
  const { interaction } = fakeInteraction({ integers: { range: 0 } });

  expect(cmd.execute(interaction)).rejects.toThrow("range must be at least 1");
});
