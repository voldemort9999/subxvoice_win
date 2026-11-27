import { describe, expect, it, vi } from "vitest";

// themes.ts reads the window's colour scheme when it loads; a node test has no window.
vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: () => {} }) });
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
const { choiceFor } = await import("./themes");

describe("choiceFor", () => {
  it("starts on Match Windows", () => {
    expect(choiceFor(null)).toBe("system");
    expect(choiceFor("system")).toBe("system");
  });

  it("keeps the meaning of a theme saved before there were two", () => {
    expect(choiceFor("night")).toBe("dark");
    expect(choiceFor("dark")).toBe("dark");
    for (const old of ["butter", "ink", "plum", "light"]) expect(choiceFor(old)).toBe("light");
  });
});
