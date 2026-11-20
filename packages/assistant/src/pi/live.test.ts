import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveModel } from "../model";
import { Agent } from "./index";

// Spends real (if tiny) money, so it only runs with LIVE=1. The key is development-only and lives
// outside git: reference/secrets/bedrock.key (journal 003, S-020).
const KEY = new URL("../../../../reference/secrets/bedrock.key", import.meta.url);
const live = process.env.LIVE === "1";

describe.skipIf(!live)("Kimi K3.1 on Bedrock through the vendored loop", () => {
  it("answers a one-line prompt", async () => {
    if (!existsSync(KEY)) throw new Error("No Bedrock key at reference/secrets/bedrock.key");
    process.env.AWS_BEARER_TOKEN_BEDROCK = readFileSync(KEY, "utf8").trim();
    process.env.AWS_REGION ??= "us-east-1";
    const { model, stream } = resolveModel("bedrock:us.moonshotai.kimi-k3.1");
    let text = "";
    const agent = new Agent({
      initialState: { systemPrompt: "Reply with exactly: OK", model, tools: [] },
      streamFn: stream,
    });
    agent.subscribe((e) => {
      if (e.type === "message_end" && e.message.role === "assistant") {
        text = e.message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
        if (e.message.stopReason === "error") text = `ERROR ${e.message.errorMessage}`;
      }
    });
    await agent.prompt("Say OK");
    expect(text).toContain("OK");
  }, 60_000);
});
