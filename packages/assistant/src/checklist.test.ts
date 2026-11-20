import { describe, expect, it } from "vitest";
import { createChecklist } from "./checklist";
import { createFinisher, SELF_CHECK } from "./finish";

const signal = new AbortController().signal;
const textOf = (m: { content: unknown }) => (m.content as { text: string }[])[0]?.text ?? "";

describe("checklist", () => {
  it("lists only the parts still pending", async () => {
    const list = createChecklist();
    expect(list.pending()).toBeUndefined();
    const out = await list.tool.run(
      {
        items: [
          { task: "volume 20", status: "done" },
          { task: "Aarnav ko likho", status: "pending" },
          { task: "Zoya ko likho", status: "impossible", note: "no such contact" },
        ],
      },
      signal,
    );
    expect(out.text).toBe("Checklist saved. 1 pending.");
    expect(list.pending()).toContain('"Aarnav ko likho"');
    expect(list.pending()).not.toContain("Zoya");
    await list.tool.run({ items: [{ task: "Aarnav ko likho", status: "done" }] }, signal);
    expect(list.pending()).toBeUndefined();
  });

  it("sends the loop back while parts are pending, at most twice, then self-checks", async () => {
    const list = createChecklist();
    await list.tool.run({ items: [{ task: "brightness 60", status: "pending" }] }, signal);
    const f = createFinisher({ lastText: () => "done", acted: () => true, pending: list.pending });
    expect(textOf(f.followUps()[0]!)).toContain('"brightness 60"');
    expect(textOf(f.followUps()[0]!)).toContain('"brightness 60"');
    expect(textOf(f.followUps()[0]!)).toBe(SELF_CHECK);
    expect(f.followUps()).toEqual([]);
  });

  it("goes straight to the self-check when nothing is pending", () => {
    const f = createFinisher({ lastText: () => "done", acted: () => true, pending: () => undefined });
    expect(textOf(f.followUps()[0]!)).toBe(SELF_CHECK);
  });
});
