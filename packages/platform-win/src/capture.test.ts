import { describe, expect, it } from "vitest";
import { fitInto, fitSize, regionToPhysical, toPhysical, toShot, WinScreenCapture } from "./capture";
import type { WindowInfo } from "./commands";
import type { PowerShellWorker } from "./powershell";

const frame = (
  display: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
) => ({
  display,
  width,
  height,
});

describe("fitSize", () => {
  it("scales a 1080p display under both the long-edge and the pixel cap", () => {
    // 1568 long edge alone gives 1568x882 = 1.38 MP, over the 1.15 MP cap.
    expect(fitSize(1920, 1080)).toEqual({ width: 1430, height: 804 });
  });

  it("never scales up", () => {
    expect(fitSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it("lets the long edge bind on an ultrawide", () => {
    expect(fitSize(3440, 1440)).toEqual({ width: 1568, height: 656 });
  });
});

describe("toPhysical", () => {
  it("maps onto a display left of the primary one", () => {
    const shot = frame({ x: -1920, y: 0, width: 1920, height: 1080 }, 960, 540);
    // Image pixel 100 covers physical 200–201 of the display; its middle is 201.
    expect(toPhysical(shot, 100, 100)).toEqual([-1719, 201]);
  });

  it("clicks the middle of the image pixel pointed at, not near its top-left corner (demo, 2026-11-19)", () => {
    // The dev PC: 2560x1440 at 100% shot at 1430x804, so one image pixel is ~1.79 physical pixels.
    const shot = frame({ x: 0, y: 0, width: 2560, height: 1440 }, 1430, 804);
    // Image pixel 3 covers physical 5.37–7.16: its middle is 6. Rounding 3 × 1.79 gave 5, a
    // physical pixel that belongs to image pixel 2.
    expect(toPhysical(shot, 3, 3)).toEqual([6, 6]);
  });

  it("maps a 150% DPI 4K display exactly on both axes", () => {
    // 3840x2160 physical (2560x1440 at 150%) right of a 2560 primary.
    const size = fitSize(3840, 2160);
    const shot = frame({ x: 2560, y: 0, width: 3840, height: 2160 }, size.width, size.height);
    // A point half a pixel before the middle is the exact middle of the display.
    expect(toPhysical(shot, size.width / 2 - 0.5, size.height / 2 - 0.5)).toEqual([2560 + 1920, 1080]);
    // The far edge stays on this display: 2560 + 3840 is the first pixel of the next one (review).
    expect(toPhysical(shot, size.width, size.height)).toEqual([2560 + 3839, 2159]);
  });

  it("takes fractional coordinates as they are rather than rounding them first", () => {
    const shot = frame({ x: 0, y: 0, width: 1920, height: 1080 }, 960, 540);
    expect(toPhysical(shot, 10.4, 10.6)).toEqual([21, 22]);
  });

  it("rejects a point off the image, naming the image's size", () => {
    const shot = frame({ x: 0, y: 0, width: 1920, height: 1080 }, 1430, 804);
    expect(() => toPhysical(shot, 1431, 10)).toThrow(/1430x804/);
    expect(() => toPhysical(shot, -1, 10)).toThrow(/outside/);
  });
});

describe("toShot", () => {
  const shot = frame({ x: -1920, y: 0, width: 1920, height: 1080 }, 960, 540);

  it("is toPhysical's inverse", () => {
    expect(toShot(shot, -1720, 200)).toEqual([100, 100]);
  });

  it("gives coordinates outside the image for a point on another display", () => {
    expect(toShot(shot, 100, 50)).toEqual([1010, 25]);
  });
});

describe("regionToPhysical", () => {
  const shot = frame({ x: 0, y: 0, width: 1920, height: 1080 }, 1430, 804);

  it("maps a zoom region from the last shot into physical pixels", () => {
    expect(regionToPhysical(shot, [715, 402, 1430, 804])).toEqual({
      x: 960,
      y: 540,
      width: 960,
      height: 540,
    });
  });

  it("rejects an empty or inverted region", () => {
    expect(() => regionToPhysical(shot, [100, 100, 100, 200])).toThrow(/x0 < x1/);
    expect(() => regionToPhysical(shot, [100, 300, 200, 200])).toThrow(/y0 < y1/);
  });
});

describe("fitInto", () => {
  it("fills the frame keeping the region's aspect ratio", () => {
    expect(fitInto(960, 540, 1430, 804)).toEqual({ width: 1429, height: 804 });
    expect(fitInto(200, 400, 1430, 804)).toEqual({ width: 402, height: 804 });
  });
});

describe("WinScreenCapture", () => {
  const windows: WindowInfo[] = [
    {
      handle: 11,
      title: "Chats - WhatsApp",
      program: "WhatsApp",
      pid: 1,
      state: "normal",
      foreground: false,
    },
    {
      handle: 22,
      title: "Untitled - Notepad",
      program: "Notepad",
      pid: 2,
      state: "normal",
      foreground: true,
    },
  ];

  const fakeWorker = (display: object) => {
    const calls: string[] = [];
    const worker = {
      async json<T>(code: string): Promise<T> {
        calls.push(code);
        if (code.startsWith("[CmdCapture]::Display(")) return display as T;
        if (code.startsWith("[CmdCapture]::Grab("))
          return { data: "AAAA", mimeType: "image/png", redacted: 1 } as T;
        throw new Error(`unexpected ${code}`);
      },
    } as unknown as PowerShellWorker;
    return { worker, calls };
  };

  it("captures the display under the foreground window when no window is named", async () => {
    const { worker, calls } = fakeWorker({ x: -1920, y: 0, width: 1920, height: 1080 });
    const capture = new WinScreenCapture(worker, { windows: async () => windows });
    const shot = await capture.screenshot();
    expect(calls).toEqual([
      "[CmdCapture]::Display(0)",
      "[CmdCapture]::Grab(-1920, 0, 1920, 1080, 1430, 804)",
    ]);
    expect(shot).toMatchObject({ width: 1430, height: 804, mimeType: "image/png", redacted: 1 });
    expect(shot.scale).toBeCloseTo(1430 / 1920);
    expect(capture.toPhysical(715, 402)).toEqual([-960, 540]);
  });

  it("captures the display of the window a hint names", async () => {
    const { worker, calls } = fakeWorker({ x: 0, y: 0, width: 1280, height: 720 });
    const capture = new WinScreenCapture(worker, { windows: async () => windows });
    await capture.screenshot({ windowHint: "WhatsApp" });
    expect(calls[0]).toBe("[CmdCapture]::Display(11)");
  });

  it("zooms within the last frame and keeps that frame for clicks", async () => {
    const { worker, calls } = fakeWorker({ x: 0, y: 0, width: 1920, height: 1080 });
    const capture = new WinScreenCapture(worker, { windows: async () => windows });
    await capture.screenshot();
    const zoomed = await capture.zoom([715, 402, 1430, 804]);
    expect(calls[2]).toBe("[CmdCapture]::Grab(960, 540, 960, 540, 1429, 804)");
    expect(zoomed.display).toEqual({ x: 960, y: 540, width: 960, height: 540 });
    expect(capture.toPhysical(715, 402)).toEqual([960, 540]);
  });

  it("asks for a screenshot before any coordinate is read", async () => {
    const { worker } = fakeWorker({ x: 0, y: 0, width: 1920, height: 1080 });
    const capture = new WinScreenCapture(worker, { windows: async () => windows });
    expect(() => capture.toPhysical(1, 1)).toThrow(/screenshot first/);
    await expect(capture.zoom([0, 0, 10, 10])).rejects.toThrow(/screenshot first/);
  });
});
