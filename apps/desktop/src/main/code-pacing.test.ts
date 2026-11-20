import { describe, expect, it } from "vitest";
import { CodePacing } from "./code-pacing";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

function clocked() {
  let at = 1_000_000;
  const pacing = new CodePacing(() => at);
  return { pacing, pass: (ms: number) => (at += ms) };
}

describe("CodePacing", () => {
  it("lets the first code go at once, then waits a minute", () => {
    const { pacing, pass } = clocked();
    expect(pacing.waitFor("a@x.com")).toBe(0);
    pacing.record("a@x.com");
    expect(pacing.status("a@x.com")).toEqual({ resendIn: 60, left: 2 });
    pass(45 * SECOND);
    expect(pacing.status("a@x.com").resendIn).toBe(15);
    expect(pacing.tooSoon("a@x.com")).toBe("Wait 15 seconds before asking for another code.");
    pass(15 * SECOND);
    expect(pacing.waitFor("a@x.com")).toBe(0);
  });

  it("stops at three codes in ten minutes, until the oldest is ten minutes old", () => {
    const { pacing, pass } = clocked();
    pacing.record("a@x.com");
    pass(MINUTE);
    pacing.record("a@x.com");
    pass(MINUTE);
    pacing.record("a@x.com");
    pass(MINUTE);
    // Three minutes past the first: seven more before the window lets a fourth through.
    expect(pacing.status("a@x.com")).toEqual({ resendIn: 7 * 60, left: 0 });
    expect(pacing.tooSoon("a@x.com")).toBe(
      "That's 3 codes in 10 minutes. Try again in 7 minutes, or continue with Google.",
    );
    pass(7 * MINUTE);
    expect(pacing.waitFor("a@x.com")).toBe(0);
    expect(pacing.status("a@x.com").left).toBe(1);
  });

  it("paces each address on its own", () => {
    const { pacing } = clocked();
    pacing.record("a@x.com");
    expect(pacing.waitFor("b@x.com")).toBe(0);
  });
});
