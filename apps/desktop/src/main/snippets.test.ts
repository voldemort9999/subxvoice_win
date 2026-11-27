import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SnippetStore } from "./snippets";

async function store() {
  const dir = await mkdtemp(join(tmpdir(), "subx-snippets-"));
  return new SnippetStore(() => join(dir, "snippets.json"));
}

describe("SnippetStore", () => {
  it("keeps snippets, newest change first, and counts their uses", async () => {
    const snippets = await store();
    const email = await snippets.save({ triggers: ["my email", " mera email "], text: "me@example.com\n" });
    await snippets.save({ triggers: ["office address"], text: "12 Park Street" });
    expect(email.triggers).toEqual(["my email", "mera email"]);
    expect(email.text).toBe("me@example.com");
    await snippets.used(email.id);
    const [first, second] = await snippets.list();
    expect(first?.triggers).toEqual(["office address"]);
    expect(second?.uses).toBe(1);
    expect((await snippets.usable()).map((item) => item.id)).toContain(email.id);
  });

  it("refuses words another snippet uses, and what is too long", async () => {
    const snippets = await store();
    const email = await snippets.save({ triggers: ["my email"], text: "a@b.c" });
    await expect(snippets.save({ triggers: ["My Email!"], text: "x" })).rejects.toThrow(
      /already uses "my email"/,
    );
    // The same snippet keeps its own words when edited.
    await expect(
      snippets.save({ id: email.id, triggers: ["my email"], text: "new@b.c" }),
    ).resolves.toBeTruthy();
    await expect(snippets.save({ triggers: ["x".repeat(61)], text: "y" })).rejects.toThrow(
      /under 60 letters/,
    );
    await expect(snippets.save({ triggers: ["long one"], text: "y".repeat(10_001) })).rejects.toThrow(
      /10,000/,
    );
  });

  it("forgets one that is removed", async () => {
    const snippets = await store();
    const one = await snippets.save({ triggers: ["sign off"], text: "Best, Bhavesh" });
    await snippets.remove(one.id);
    expect(await snippets.list()).toEqual([]);
  });
});
