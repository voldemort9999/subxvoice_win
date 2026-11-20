import { describe, expect, it } from "vitest";
import { editsIn, learnFromEdit, mergeLearned } from "./learn";

describe("learning from the user's fixes", () => {
  it("learns a name the user corrected in what we pasted", () => {
    expect(learnFromEdit("Send the build to Arnav by Friday", "Send the build to Aarnav by Friday")).toEqual([
      { word: "Aarnav", heardAs: "Arnav", name: true },
    ]);
  });

  it("finds our text inside a field that holds more", () => {
    const pasted = "send the SUBX voice build to the seller's team";
    const field = "Hi all, quick update. send the SUBXVoice build to the Celeris team. Thanks, Aryan";
    expect(learnFromEdit(pasted, field)).toEqual([
      { word: "SUBXVoice", heardAs: "SUBX voice", name: true },
      { word: "Celeris", heardAs: "seller's", name: true },
    ]);
  });

  it("learns a capital the user added to a name", () => {
    expect(learnFromEdit("WhatsApp pe bhavesh ko bol do", "WhatsApp pe Bhavesh ko bol do")).toEqual([
      { word: "Bhavesh", heardAs: "bhavesh", name: true },
    ]);
  });

  it("learns ordinary words too, in any script, marked as not names", () => {
    expect(learnFromEdit("kal parson office aaunga", "kal parso office aaunga")).toEqual([
      { word: "parso", heardAs: "parson", name: false },
    ]);
    expect(learnFromEdit("भविष्य को बोल दो", "भावेश को बोल दो")).toEqual([
      { word: "भावेश", heardAs: "भविष्य", name: false },
    ]);
  });

  it("tells a field without our text apart from one with nothing to learn", () => {
    expect(editsIn("kal meeting 11 baje hai", "")).toBeNull();
    expect(editsIn("kal meeting 11 baje hai", "kal meeting 11 baje hai")).toEqual([]);
  });

  it("does not learn when the user rewrote the sentence", () => {
    expect(
      learnFromEdit("can you send the report by Monday", "Please share the Q3 deck with Rahul today"),
    ).toEqual([]);
  });

  // User, 2026-11-20: "words par kaam kare as single words … lines ya phrases ke liye tayiyaar nahi".
  it("learns single words only, never a phrase", () => {
    expect(learnFromEdit("Arnav ko bol do", "Aar Nav ko bol do")).toEqual([]);
    expect(learnFromEdit("meet Rohit Shrma today", "meet Rohit Sharma today")).toEqual([
      { word: "Sharma", heardAs: "Shrma", name: true },
    ]);
    // Two words in a row each fixed is two words, not one phrase.
    expect(learnFromEdit("call arnav shrma now", "call Aarnav Sharma now")).toEqual([]);
  });

  // Windows hand test, 2026-11-20: "Maujooma" fixed to "Mojmar" twice, and nothing was learned —
  // au/o and oo/o made the two look like different words, though they are the same name.
  it("sees Hindi spellings of one name as one name: au/o, oo/u, aa/a, ee/i", () => {
    const pasted =
      "Okay, toh Maujooma ek aisa platform hai jo ki ek interview copilot helper hai. Maujooma. Okay?";
    const field =
      "Okay, toh Mojmar ek aisa platform hai jo ki ek interview copilot helper hai. Mojmar. Okay?";
    expect(learnFromEdit(pasted, field)).toEqual([{ word: "Mojmar", heardAs: "Maujooma", name: true }]);
    expect(learnFromEdit("Shreeya ko bolo", "Shriya ko bolo")).toEqual([
      { word: "Shriya", heardAs: "Shreeya", name: true },
    ]);
  });

  it("does not take an unrelated word for a spelling fix", () => {
    expect(learnFromEdit("meeting with Rohan at 5", "meeting with Priya at 5")).toEqual([]);
  });

  it("does not take a translation for a spelling fix", () => {
    expect(learnFromEdit("भविष्य को बोल दो", "Bhavesh को बोल दो")).toEqual([]);
  });

  // Windows hand test, 2026-11-20: two dictations into one box with no space between them read as
  // a fix, and "Jootiyan mat karoJyotiyaapa" was learned. Nobody had edited anything.
  it("does not take the text before ours, glued on with no space, for a fix", () => {
    expect(learnFromEdit("Jyotiyaapa mat karo", "Jootiyan mat karoJyotiyaapa mat karo")).toEqual([]);
    expect(learnFromEdit("Arnav ko message kar dena", "pehle ka textArnav ko message kar dena")).toEqual([]);
    expect(learnFromEdit("Arnav ko message kar dena", "textArnav ko message kar dena")).toEqual([]);
    // A real fix that adds a letter or two is still one.
    expect(learnFromEdit("Arnav ko message kar dena", "Aarnav ko message kar dena")).toEqual([
      { word: "Aarnav", heardAs: "Arnav", name: true },
    ]);
  });

  it("does not learn a phrase that grew around the word we wrote", () => {
    expect(learnFromEdit("Arnav ko bol do", "Aarnav bhai ji ko bol do")).toEqual([]);
  });

  it("learns nothing when our text is gone", () => {
    expect(learnFromEdit("kal meeting 11 baje hai", "")).toEqual([]);
    expect(learnFromEdit("kal meeting 11 baje hai", "something else entirely")).toEqual([]);
  });

  it("adds learned words as vocabulary, never as replacement rules, and never twice", () => {
    const entries = [{ word: "Aryan", misheardAs: ["Arian"] }];
    expect(
      mergeLearned(entries, [
        { word: "Aarnav", heardAs: "Arnav", name: true },
        { word: "aryan", heardAs: "arian", name: false },
      ]),
    ).toEqual([
      { word: "Aryan", misheardAs: ["Arian"] },
      { word: "Aarnav", misheardAs: [] },
    ]);
  });
});
