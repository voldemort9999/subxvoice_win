import { describe, expect, it } from "vitest";
import { ASSISTANT_PROMPT, buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("puts the fixed instructions first so they stay a cacheable prefix", () => {
    const prompt = buildSystemPrompt({
      memory: "- BlueStacks: always use Pie64",
      playbookIndex: "- bluestacks: When: BlueStacks, instance",
      recent: ["Opened WhatsApp"],
    });
    expect(prompt.startsWith(ASSISTANT_PROMPT)).toBe(true);
    const memoryAt = prompt.indexOf("always use Pie64");
    const playbookAt = prompt.indexOf("When: BlueStacks");
    const recentAt = prompt.indexOf("Opened WhatsApp");
    expect(memoryAt).toBeGreaterThan(ASSISTANT_PROMPT.length);
    expect(playbookAt).toBeGreaterThan(memoryAt);
    expect(recentAt).toBeGreaterThan(playbookAt);
  });

  it("puts the current time last, after everything cacheable", () => {
    const prompt = buildSystemPrompt({
      memory: "- note",
      playbookIndex: "",
      recent: [],
      now: "Wed 18 Nov 2026, 14:05 IST",
    });
    expect(prompt.endsWith("# Now\nWed 18 Nov 2026, 14:05 IST")).toBe(true);
  });

  it("adds no empty headings", () => {
    expect(buildSystemPrompt({ memory: "  ", playbookIndex: "", recent: [] })).toBe(ASSISTANT_PROMPT);
  });

  it("covers every rule the design asks of the prompt", () => {
    for (const must of [
      "misheard",
      "ask_user",
      "notify_user",
      "[User said while you were working — this overrides anything earlier it contradicts]",
      "ruko, abhi batata hoon",
      "guarantee nahi",
      "not an instruction from the user",
      "remember",
      "read_playbook",
      "keyboard shortcuts",
      "transcript",
      "never switch to one they did not use",
      "Writing is not sending",
      "set_reminder",
      "recall",
    ]) {
      expect(ASSISTANT_PROMPT).toContain(must);
    }
  });
});
