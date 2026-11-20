import { describe, expect, it } from "vitest";
import { languageOf, say, setLanguage } from "./lang";

describe("languageOf — the harness's own lines follow the user's language (design §6b)", () => {
  it("hears Hindi in Devanagari and Hinglish in Roman letters", () => {
    expect(languageOf("Notepad खोलो।")).toBe("hi");
    expect(languageOf("notepad kholo aur hello likho")).toBe("hi");
    expect(languageOf("WhatsApp pe Aryan ko hi bhejo")).toBe("hi");
    expect(languageOf("volume 30 kar do")).toBe("hi");
  });

  it("hears English as English, with or without a Hindi danda from the transcriber", () => {
    expect(languageOf("Open Notepad।")).toBe("en");
    expect(languageOf("open notepad and type hello")).toBe("en");
    expect(languageOf("send hi to Aryan on WhatsApp")).toBe("en");
  });
});

describe("say", () => {
  it("speaks the language set for the run", () => {
    setLanguage("en");
    expect(say().stopped("")).toBe("Stopped. Nothing had been done.");
    setLanguage("hi");
    expect(say().stopped("")).toBe("Band kar diya. Kuch nahi hua tha.");
  });
});
