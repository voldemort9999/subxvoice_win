import { describe, expect, it } from "vitest";
import { pillShownNow, pillZoom } from "./pill-place";

describe("pillZoom", () => {
  it("draws the pill smaller on a small screen, never under 80%", () => {
    expect(pillZoom(1536)).toBe(0.85); // 1080p laptop at Windows' 125% (the user's)
    expect(pillZoom(1920)).toBe(1); // 1080p at 100%
    expect(pillZoom(2560)).toBe(1);
    expect(pillZoom(1280)).toBe(0.8); // 1080p at 150%: the floor
  });
});

describe("pillShownNow", () => {
  it("hides the idle pill until a hide from its menu runs out", () => {
    expect(pillShownNow({ pillWhenIdle: true, pillHiddenUntil: 0 }, 1000)).toBe(true);
    expect(pillShownNow({ pillWhenIdle: true, pillHiddenUntil: 5000 }, 1000)).toBe(false);
    expect(pillShownNow({ pillWhenIdle: true, pillHiddenUntil: 5000 }, 6000)).toBe(true);
    expect(pillShownNow({ pillWhenIdle: false, pillHiddenUntil: 0 }, 1000)).toBe(false);
  });
});
