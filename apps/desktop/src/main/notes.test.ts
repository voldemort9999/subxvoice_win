import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotesStore } from "./notes";

async function store() {
  const dir = await mkdtemp(join(tmpdir(), "subx-notes-"));
  return new NotesStore(() => join(dir, "drafts.json"));
}

describe("NotesStore", () => {
  it("keeps a note under the id it was opened with, and changes only what is given", async () => {
    const notes = await store();
    const first = await notes.save({ id: "tab-1", text: "Hello Aarnav" });
    expect(first.createdAt).toBeGreaterThan(0);
    const pinned = await notes.save({ id: "tab-1", pinned: true });
    expect(pinned.text).toBe("Hello Aarnav");
    expect(pinned.pinned).toBe(true);
    // Pinning is not a change to the words: the time it was changed stays.
    expect(pinned.updatedAt).toBe(first.updatedAt);
    const typed = await notes.save({ id: "tab-1", text: "Hello Aarnav, see you" });
    expect(typed.pinned).toBe(true);
    expect((await notes.list()).map((note) => note.id)).toEqual(["tab-1"]);
  });

  it("removes one, and refuses a note too long to keep", async () => {
    const notes = await store();
    await notes.save({ id: "a", text: "one" });
    await notes.remove("a");
    expect(await notes.list()).toEqual([]);
    await expect(notes.save({ id: "b", text: "x".repeat(200_001) })).rejects.toThrow(/too long/);
  });
});
