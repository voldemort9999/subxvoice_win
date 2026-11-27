import { describe, expect, it } from "vitest";
import { kindOf } from "./webMic";

describe("kindOf", () => {
  it("knows a microphone by the name Windows gives it", () => {
    expect(kindOf("Microphone Array (Realtek(R) Audio)")).toBe("built-in");
    expect(kindOf("Microphone (Intel® Smart Sound Technology for Digital Microphones)")).toBe("built-in");
    expect(kindOf("Headset Microphone (AirPods Pro Hands-Free)")).toBe("bluetooth");
    expect(kindOf("Microphone (Yeti Stereo Microphone)")).toBe("wired");
    expect(kindOf("Microphone (USB Audio Device)")).toBe("wired");
    expect(kindOf("CABLE Output (VB-Audio Virtual Cable)")).toBe("virtual");
    expect(kindOf("Microphone (NVIDIA Broadcast)")).toBe("virtual");
    expect(kindOf("Microphone (Phone Link)")).toBe("iphone");
    expect(kindOf("Microphone (HyperX Cloud III) (03f0:089d)")).toBe("wired");
    expect(kindOf("Microphone (DroidCam Audio)")).toBe("iphone");
    expect(kindOf("Microphone (Some Brand)")).toBe("other");
  });
});
