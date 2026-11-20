import { describe, expect, it } from "vitest";
import { micConstraints } from "./mic-constraints";

describe("micConstraints", () => {
  it("cleans the signal the way calls do when voice cleanup is on", () => {
    expect(micConstraints("", true)).toEqual({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  });

  it("hands over the raw signal when the user turns cleanup off", () => {
    expect(micConstraints("", false)).toEqual({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  });

  it("prefers the picked microphone and falls back to the default if it is gone", () => {
    expect(micConstraints("abc", true).audio).toMatchObject({ deviceId: { ideal: "abc" } });
  });
});
