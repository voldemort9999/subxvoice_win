import { describe, expect, it } from "vitest";
import { WinFieldReader } from "./field";

/** A field whose text and window the test sets, and a clock the test moves. */
function setup(values: (string | null)[], fronts: number[] = [1]) {
  let reads = 0;
  let polls = 0;
  const reader = new WinFieldReader({
    read: async () => values[Math.min(reads++, values.length - 1)] ?? null,
    foreground: () => fronts[Math.min(polls++, fronts.length - 1)] ?? 1,
    pollMs: 1,
  });
  const texts: string[] = [];
  const ends: (string | undefined)[] = [];
  return {
    reader,
    texts,
    ends,
    on: [(t: string) => void texts.push(t), (r?: string) => void ends.push(r)] as const,
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("WinFieldReader (auto-learn reads the box back, like the Mac's FieldWatcher)", () => {
  it("reports the text now and each change, not repeats", async () => {
    const { reader, texts, on } = setup(["hello Aryn", "hello Aryn", "hello Aryan"]);
    const watch = reader.watch(on[0], on[1], 1000);
    await wait(40);
    watch.stop();
    expect(texts).toEqual(["hello Aryn", "hello Aryan"]);
  });

  it("ends once when the user moves to another window", async () => {
    const { reader, ends, on } = setup(["a", "a", "a"], [1, 1, 2]);
    reader.watch(on[0], on[1], 1000);
    await wait(40);
    expect(ends).toEqual(["moved"]);
  });

  it("ends at once when the box cannot be read (a password box, no text)", async () => {
    const { reader, texts, ends, on } = setup([null]);
    reader.watch(on[0], on[1], 1000);
    await wait(20);
    expect(texts).toEqual([]);
    expect(ends).toEqual(["unreadable"]);
  });

  it("ends when its time is up, and stop() after that adds nothing", async () => {
    const { reader, ends, on } = setup(["x"]);
    const watch = reader.watch(on[0], on[1], 15);
    await wait(60);
    watch.stop();
    expect(ends).toEqual(["time"]);
  });
});
