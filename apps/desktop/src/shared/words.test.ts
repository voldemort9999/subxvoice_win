import { describe, expect, it } from "vitest";
import { wordCount } from "./words";

describe("wordCount, in any language", () => {
  it("counts spaced languages by the words between spaces", () => {
    expect(wordCount("मुझे कल ऑफिस जाना है")).toBe(5);
    expect(wordCount("I know how things are going")).toBe(6);
    expect(wordCount("Mañana no puedo ir a la reunión")).toBe(7);
    expect(wordCount("내일 회의에 늦을 것 같아요")).toBe(5);
  });

  it("does not count dashes or other marks, and keeps figures and addresses whole", () => {
    expect(wordCount("Kal main office jaunga — theek hai?")).toBe(6);
    expect(wordCount("₹2,000 at 3:30 PM, 50% off")).toBe(6);
    expect(wordCount("send it to aryan.sharma@gmail.com")).toBe(4);
    expect(wordCount("  —  …  ")).toBe(0);
    expect(wordCount("")).toBe(0);
  });

  // Splitting on spaces counted each of these sentences as one word (2026-11-20).
  it("finds the words in scripts written without spaces", () => {
    expect(wordCount("明日の三時に会議があります。")).toBeGreaterThanOrEqual(6);
    expect(wordCount("我明天会晚一点到，你可以先开始吗")).toBeGreaterThanOrEqual(8);
    expect(wordCount("ผมจะไปถึงช้าหน่อย")).toBeGreaterThanOrEqual(4);
    expect(wordCount("SUBXVoice 会议 tomorrow")).toBeGreaterThanOrEqual(3);
  });
});
