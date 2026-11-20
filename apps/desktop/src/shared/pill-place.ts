// Where the pill can sit: the four corners and the middle of each edge. A drag ends at whichever
// is nearest, so the pill is never left floating mid-screen over someone's work.

export type PillPlace =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export const PILL_PLACES: readonly PillPlace[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

export const isPillPlace = (value: unknown): value is PillPlace =>
  typeof value === "string" && (PILL_PLACES as readonly string[]).includes(value);

/** Thirds of the screen: the outer thirds are a side, the middle third is the centre line. */
export function nearestPlace(fx: number, fy: number): PillPlace {
  const column = fx < 1 / 3 ? "left" : fx > 2 / 3 ? "right" : "centre";
  const row = fy < 1 / 3 ? "top" : fy > 2 / 3 ? "bottom" : "middle";
  if (row === "middle") {
    // The middle of the screen is no place for it: the nearer of top and bottom edge.
    if (column === "centre") return fy < 0.5 ? "top" : "bottom";
    return column;
  }
  return column === "centre" ? row : `${row}-${column}`;
}

/** Which way the pill lines up inside its window, so it hugs the edge it was put on. */
export function alignment(place: PillPlace): {
  horizontal: "start" | "center" | "end";
  vertical: "start" | "center" | "end";
} {
  return {
    horizontal:
      place.endsWith("left") || place === "left"
        ? "start"
        : place.endsWith("right") || place === "right"
          ? "end"
          : "center",
    vertical: place.startsWith("top") ? "start" : place.startsWith("bottom") ? "end" : "center",
  };
}
