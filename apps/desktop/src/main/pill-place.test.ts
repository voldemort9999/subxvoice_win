import { describe, expect, it } from "vitest";
import { alignment, nearestPlace } from "../shared/pill-place";

describe("where a dropped pill lands", () => {
  it("snaps to the nearest corner or edge", () => {
    expect(nearestPlace(0.05, 0.95)).toBe("bottom-left");
    expect(nearestPlace(0.5, 0.97)).toBe("bottom");
    expect(nearestPlace(0.9, 0.02)).toBe("top-right");
    expect(nearestPlace(0.02, 0.5)).toBe("left");
    expect(nearestPlace(0.98, 0.45)).toBe("right");
  });

  it("never stays in the middle of the screen", () => {
    expect(nearestPlace(0.5, 0.45)).toBe("top");
    expect(nearestPlace(0.5, 0.55)).toBe("bottom");
  });

  it("lines the pill up against the edge it was put on", () => {
    expect(alignment("top-right")).toEqual({ horizontal: "end", vertical: "start" });
    expect(alignment("left")).toEqual({ horizontal: "start", vertical: "center" });
    expect(alignment("bottom")).toEqual({ horizontal: "center", vertical: "end" });
  });
});
