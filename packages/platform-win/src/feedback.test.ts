import { describe, expect, it } from "vitest";
import { tone, WinAudioFeedback } from "./feedback";

function setup(muted: boolean) {
  const played: Buffer[] = [];
  const state = { muted, sets: [] as boolean[] };
  const feedback = new WinAudioFeedback({
    play: (wav) => void played.push(wav),
    isMuted: async () => state.muted,
    setMuted: async (on) => {
      state.muted = on;
      state.sets.push(on);
    },
  });
  return { feedback, played, state };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WinAudioFeedback (the Mac app's sounds and mute, on Windows)", () => {
  it("plays a different short sound for start, stop and notice", () => {
    const { feedback, played } = setup(false);
    feedback.cue("start");
    feedback.cue("stop");
    feedback.cue("notice");
    expect(played).toHaveLength(3);
    expect(new Set(played.map((wav) => wav.toString("base64"))).size).toBe(3);
  });

  it("mutes while dictating and unmutes after", async () => {
    const { feedback, state } = setup(false);
    feedback.muteOutput(true);
    await settle();
    expect(state.muted).toBe(true);
    feedback.muteOutput(false);
    await settle();
    expect(state.muted).toBe(false);
  });

  it("leaves an output the user had muted muted", async () => {
    const { feedback, state } = setup(true);
    feedback.muteOutput(true);
    feedback.muteOutput(false);
    await settle();
    await settle();
    expect(state.muted).toBe(true);
    expect(state.sets).toEqual([]);
  });

  it("makes a valid 16-bit mono WAV", () => {
    const wav = tone([660, 880], 60);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
  });
});
