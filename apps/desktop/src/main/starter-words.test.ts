import type { DictionaryEntry } from "@subx/core";
import { MemoryDictionary } from "@subx/core/fakes";
import { describe, expect, it } from "vitest";
import { addStarterWords, fixCapitalNames, nameWords, PRODUCT_WORD } from "./starter-words";

describe("the words every dictionary starts with", () => {
  it("splits a name into words, with a capital where it was typed in lowercase", () => {
    expect(nameWords("choudhary aryan")).toEqual(["Choudhary", "Aryan"]);
    expect(nameWords("Aarnav  Mathakiya")).toEqual(["Aarnav", "Mathakiya"]);
    expect(nameWords("A. P. J. Abdul Kalam")).toEqual(["Abdul", "Kalam"]);
    expect(nameWords("D'Souza O'Brien-Lee")).toEqual(["D'Souza", "O'Brien-Lee"]);
    expect(nameWords("आर्यन चौधरी")).toEqual(["आर्यन", "चौधरी"]);
    expect(nameWords("")).toEqual([]);
  });

  it("adds SUBXVoice and the name, and leaves a spelling the person already has", async () => {
    const dictionary = new MemoryDictionary([{ word: "aryan", misheardAs: ["arian"] } as DictionaryEntry]);
    expect(await addStarterWords(dictionary, "choudhary aryan", 1)).toBe(2);
    const words = (await dictionary.all()).map((entry) => entry.word);
    expect(words).toEqual(["aryan", PRODUCT_WORD.word, "Choudhary"]);
    expect((await dictionary.all()).find((entry) => entry.word === "SUBXVoice")?.misheardAs).toContain(
      "sab x voice",
    );
    // A second time adds nothing.
    expect(await addStarterWords(dictionary, "choudhary aryan", 2)).toBe(0);
  });
});

describe("names in capitals", () => {
  it("gives a name typed all in capitals a capital, and keeps short initials", () => {
    expect(nameWords("BHAVESH PARMAR")).toEqual(["Bhavesh", "Parmar"]);
    expect(nameWords("AJ Styles")).toEqual(["AJ", "Styles"]);
  });

  it("fixes a name given in capitals in place", async () => {
    const dictionary = new MemoryDictionary([{ word: "BHAVESH", misheardAs: ["bhavish"], source: "you" }]);
    expect(await fixCapitalNames(dictionary, "BHAVESH")).toBe(1);
    expect((await dictionary.all()).map((entry) => [entry.word, entry.misheardAs])).toEqual([
      ["Bhavesh", ["bhavish"]],
    ]);
  });
});
