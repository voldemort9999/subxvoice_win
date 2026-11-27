import { describe, expect, it } from "vitest";
import { plain, type Snippet, snippetFrom, snippetInside, wholeSnippet } from "./snippets";

// The Mac app's SnippetsTests, case for case.
const email: Snippet = {
  id: "1",
  triggers: ["my email", "mera email", "मेरा ईमेल"],
  text: "aryan@example.com",
};
const work: Snippet = { id: "2", triggers: ["my work email"], text: "aryan@company.com" };
const address: Snippet = { id: "3", triggers: ["office address"], text: "12 Park Street\nKolkata 700016" };
const all = [email, work, address];

describe("snippets", () => {
  it("takes the whole dictation as a trigger, whatever the clean-up added", () => {
    expect(wholeSnippet("my email", all)).toBe(email);
    expect(wholeSnippet("My email.", all)).toBe(email);
    expect(wholeSnippet("  MY   EMAIL!  ", all)).toBe(email);
    expect(wholeSnippet("Office address", all)).toBe(address);
  });

  it("works in any language or script", () => {
    expect(wholeSnippet("Mera email.", all)).toBe(email);
    expect(wholeSnippet("मेरा ईमेल।", all)).toBe(email);
  });

  it("does not take more than the trigger as whole", () => {
    expect(wholeSnippet("I'll check my email later.", all)).toBeNull();
    expect(wholeSnippet("email", all)).toBeNull();
    expect(wholeSnippet("", all)).toBeNull();
    expect(wholeSnippet("...", all)).toBeNull();
  });

  it("finds a trigger inside a sentence, with its replacement", () => {
    const found = snippetInside("Send it to my email, please.", all);
    expect(found?.snippet).toBe(email);
    expect(found?.trigger).toBe("my email");
    expect(found?.text).toBe("Send it to aryan@example.com, please.");
  });

  it("lets the longest trigger win", () => {
    const found = snippetInside("Use my work email for this.", all);
    expect(found?.snippet).toBe(work);
    expect(found?.text).toBe("Use aryan@company.com for this.");
  });

  it("matches whole words only", () => {
    expect(snippetInside("Check my emails today.", all)).toBeNull();
    expect(snippetInside("Nothing to see here.", all)).toBeNull();
  });

  it("ignores case and spacing inside", () => {
    expect(snippetInside("Mera contact hai: Mera  Email.", all)?.text).toBe(
      "Mera contact hai: aryan@example.com.",
    );
  });

  it("takes a snippet's text as it is", () => {
    const price: Snippet = { id: "4", triggers: ["the price"], text: "$1,200 (incl. tax)" };
    expect(snippetInside("It costs the price today.", [price])?.text).toBe(
      "It costs $1,200 (incl. tax) today.",
    );
  });

  it("reads saved records", () => {
    expect(snippetFrom({ id: "a", triggers: ["my email", " "], text: "x@y.z" })).toEqual({
      id: "a",
      triggers: ["my email"],
      text: "x@y.z",
    });
    expect(snippetFrom({ id: "a", triggers: ["  "], text: "x" })).toBeNull();
    expect(snippetFrom({ id: "a", triggers: ["my email"], text: "  " })).toBeNull();
  });

  it("finds triggers in scripts written without spaces", () => {
    const chinese: Snippet = { id: "zh", triggers: ["我的邮箱"], text: "aryan@example.com" };
    const japanese: Snippet = { id: "ja", triggers: ["私のメール"], text: "aryan@example.com" };
    const thai: Snippet = { id: "th", triggers: ["อีเมลของฉัน"], text: "aryan@example.com" };
    expect(snippetInside("请发到我的邮箱。", [chinese])?.text).toBe("请发到aryan@example.com。");
    expect(wholeSnippet("我的邮箱。", [chinese])).toBe(chinese);
    expect(snippetInside("これを私のメールに送ってください。", [japanese])?.text).toBe(
      "これをaryan@example.comに送ってください。",
    );
    expect(snippetInside("ส่งไปที่อีเมลของฉันนะ", [thai])?.text).toBe("ส่งไปที่aryan@example.comนะ");
  });

  it("keeps word edges in other scripts", () => {
    const korean: Snippet = { id: "ko", triggers: ["내 이메일"], text: "x@y.z" };
    expect(snippetInside("내 이메일로 보내", [korean])).toBeNull();
    expect(snippetInside("보내 내 이메일 지금", [korean])?.text).toBe("보내 x@y.z 지금");
    const arabic: Snippet = { id: "ar", triggers: ["بريدي"], text: "x@y.z" };
    expect(snippetInside("أرسله إلى بريدي الآن", [arabic])?.text).toBe("أرسله إلى x@y.z الآن");
  });

  it("compares in plain words", () => {
    expect(plain("  Hello,  World! ")).toBe("hello world");
  });
});
