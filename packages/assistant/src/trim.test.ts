import { describe, expect, it } from "vitest";
import { trimTree } from "./trim";

const tree = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    if (i === 3) return `e${i} Edit "Search" [0,0,10,10]`;
    if (i === 250) return `e${i} Button "Send" [0,0,10,10]`;
    if (i === 120) return `e${i} ListItem "Aryan" (focused) [0,0,10,10]`;
    return `e${i} Text "Some long message preview number ${i} that nobody needs" [0,0,10,10]`;
  }).join("\n");

describe("trimTree", () => {
  it("leaves a small tree alone", () => {
    const small = tree(5);
    expect(trimTree(small)).toBe(small);
  });

  it("keeps every box and button, and the focused element, within the budget", () => {
    const out = trimTree(tree(400), 3000);
    expect(out).toContain('e3 Edit "Search"');
    expect(out).toContain('e250 Button "Send"');
    expect(out).toContain('e120 ListItem "Aryan" (focused)');
    expect(out.length).toBeLessThanOrEqual(3000 + 120);
  });

  it("says how much it left out and how to get it", () => {
    expect(trimTree(tree(400), 3000)).toMatch(/\(\d+ more elements not shown — read again with a filter\)$/);
  });

  it("keeps what it kept in the window's own order", () => {
    const ids = [...trimTree(tree(400), 3000).matchAll(/^e(\d+)/gm)].map((m) => Number(m[1]));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});
