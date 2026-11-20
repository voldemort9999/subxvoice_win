import { describe, expect, it } from "vitest";
import { closest, resolveOne } from "./match";

describe("closest", () => {
  it("names the real one a misheard name is nearest to (friend's bench: 'Aryn' passed 0–13%)", () => {
    expect(closest("Aryn", ["Arjun", "Aryan", "Yash arya"])).toBe("Aryan");
    expect(closest("dragon", ["Dragon Bhai", "Drona"])).toBe("Dragon Bhai");
  });

  it("says nothing is close rather than offering a stranger", () => {
    expect(closest("Aryn", ["Mummy", "Papa"])).toBeNull();
    expect(closest("Aryn", [])).toBeNull();
  });
});

const name = (item: { name: string }) => item.name;
const apps = [{ name: "Google Chrome" }, { name: "Notepad" }, { name: "Notepad++" }, { name: "WhatsApp" }];

describe("resolveOne", () => {
  it("prefers an exact name over a looser match that would otherwise tie", () => {
    // "notepad" is a prefix of both, but only one is exactly it.
    expect(resolveOne("notepad", apps, name).chosen).toEqual({ name: "Notepad" });
  });

  it("resolves on a whole word inside a longer name", () => {
    expect(resolveOne("chrome", apps, name)).toMatchObject({
      chosen: { name: "Google Chrome" },
      how: "word",
    });
  });

  it("reports several matches as ambiguous instead of taking the first", () => {
    const devices = [{ name: "NVIDIA Output 1" }, { name: "NVIDIA Output 2" }];
    const match = resolveOne("nvidia", devices, name);
    expect(match.chosen).toBeNull();
    expect(match.how).toBe("ambiguous");
    expect(match.candidates).toHaveLength(2);
  });

  it("treats a hyphen, dot or underscore like a space — a writer spells titles either way", () => {
    // S-024: "BlueStacks Multi-Instance Manager" was asked for, the window is titled
    // "BlueStacks Multi Instance Manager", and closing it failed with "Couldn't find".
    const windows = [{ name: "BlueStacks Multi Instance Manager" }, { name: "Untitled - Notepad" }];
    expect(resolveOne("BlueStacks Multi-Instance Manager", windows, name)).toMatchObject({
      chosen: { name: "BlueStacks Multi Instance Manager" },
      how: "exact",
    });
    expect(resolveOne("Untitled - Notepad", windows, name).how).toBe("exact");
  });

  it("says none when nothing matches, which is a different answer from ambiguous", () => {
    expect(resolveOne("spotify", apps, name)).toEqual({ chosen: null, candidates: [], how: "none" });
  });

  it("lets an exact id win even when the names collide", () => {
    const procs = [
      { name: "chrome", pid: "11" },
      { name: "chrome", pid: "22" },
    ];
    expect(
      resolveOne(
        "22",
        procs,
        (p) => p.name,
        (p) => p.pid,
      ).chosen,
    ).toEqual({ name: "chrome", pid: "22" });
  });

  it("does not let a word match inside another word", () => {
    // "pad" is inside "Notepad" but is not a word of it, so it falls to substring and ties.
    expect(resolveOne("pad", apps, name).how).toBe("ambiguous");
  });

  it("treats an empty query as no match rather than matching everything", () => {
    expect(resolveOne("  ", apps, name).how).toBe("none");
  });
});
