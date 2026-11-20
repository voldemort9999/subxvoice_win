import { describe, expect, it } from "vitest";
import { assistantModels, classicModels, scriptNote } from "./assistant-model";

describe("scriptNote", () => {
  it("tells the assistant to type in Roman letters when that is the user's setting (S-024: it typed Devanagari)", () => {
    expect(scriptNote("roman")).toMatch(/Roman \(Latin\) letters/);
    expect(scriptNote("roman")).toMatch(/never translate/i);
    expect(scriptNote("native")).toBe("");
  });
});

describe("classicModels", () => {
  it("keeps Jev + Gemini through the backend in the installed app, whatever .env says", () => {
    expect(
      classicModels(true, { CELERIS_API_KEY: "ck", DECIDER_MODEL: "celeris:celeris-1.1-decision" }),
    ).toEqual({
      decider: "jev:typesafe/jev-1.14",
      writer: "openrouter:google/gemini-2.5-flash",
    });
  });

  it("runs both on Celeris in development when its key is there (user, S-023)", () => {
    expect(classicModels(false, { CELERIS_API_KEY: "ck" })).toEqual({
      decider: "celeris:celeris-1.1-decision",
      writer: "celeris:celeris-1",
    });
    expect(classicModels(false, {})).toEqual({
      decider: "jev:typesafe/jev-1.14",
      writer: "openrouter:google/gemini-2.5-flash",
    });
  });

  it("switches either one from .env", () => {
    expect(
      classicModels(false, {
        CELERIS_API_KEY: "ck",
        DECIDER_MODEL: " jev:typesafe/jev-1.14 ",
        COMMAND_MODEL: "celeris:celeris-1-magnus",
      }),
    ).toEqual({ decider: "jev:typesafe/jev-1.14", writer: "celeris:celeris-1-magnus" });
  });
});

describe("assistantModels", () => {
  it("runs Haiku in the installed app, with Sonnet as the fallback, whatever .env says", () => {
    expect(assistantModels(true, { ASSISTANT_MODEL: "bedrock:us.moonshotai.kimi-k3.1" })).toEqual({
      model: "openrouter:anthropic/claude-haiku-5.5",
      fallback: "openrouter:anthropic/claude-sonnet-5.5",
    });
  });

  it("runs Celeris in development, Kimi as the fallback, unless .env names another model", () => {
    // The user chose Celeris for speed (S-023); Kimi stays as the fallback on Bedrock.
    expect(assistantModels(false, {})).toEqual({
      model: "celeris:celeris-1",
      fallback: "bedrock:us.moonshotai.kimi-k3.1",
    });
    expect(
      assistantModels(false, {
        ASSISTANT_MODEL: " openrouter:anthropic/claude-haiku-5.5 ",
        ASSISTANT_FALLBACK_MODEL: "",
      }),
    ).toEqual({
      model: "openrouter:anthropic/claude-haiku-5.5",
      fallback: "bedrock:us.moonshotai.kimi-k3.1",
    });
  });
});
