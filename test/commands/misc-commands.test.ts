import { expect, mock, test } from "bun:test";
import Disconnect from "../../src/commands/disconnect.js";
import Volume from "../../src/commands/volume.js";
import { fakeInteraction, fakeManager } from "../helpers/discord.js";

test("disconnect: disconnects when connected", async () => {
  const leave = mock(() => {});
  const cmd = new Disconnect(fakeManager({ voiceConnection: {}, leave }));
  const { interaction, replies } = fakeInteraction();

  await cmd.execute(interaction);

  expect(leave).toHaveBeenCalled();
  expect(replies[0]).toContain("disconnected");
});

test("disconnect: throws when not connected", async () => {
  const cmd = new Disconnect(
    fakeManager({ voiceConnection: null, leave: () => {} }),
  );
  const { interaction } = fakeInteraction();

  expect(cmd.execute(interaction)).rejects.toThrow("not connected");
});

test("volume: sets the volume level", async () => {
  const setVolume = mock(() => {});
  const cmd = new Volume(fakeManager({ getCurrent: () => ({}), setVolume }));
  const { interaction, replies } = fakeInteraction({ integers: { level: 50 } });

  await cmd.execute(interaction);

  expect(setVolume).toHaveBeenCalledWith(50);
  expect(replies[0]).toBe("Set volume to 50%");
});

test("volume: defaults to 100 when no level is given", async () => {
  const setVolume = mock(() => {});
  const cmd = new Volume(fakeManager({ getCurrent: () => ({}), setVolume }));
  const { interaction } = fakeInteraction();

  await cmd.execute(interaction);

  expect(setVolume).toHaveBeenCalledWith(100);
});

test("volume: throws when nothing is playing", async () => {
  const cmd = new Volume(
    fakeManager({ getCurrent: () => null, setVolume: () => {} }),
  );
  const { interaction } = fakeInteraction({ integers: { level: 50 } });

  expect(cmd.execute(interaction)).rejects.toThrow("nothing is playing");
});
