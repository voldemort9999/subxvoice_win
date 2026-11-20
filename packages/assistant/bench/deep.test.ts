import { describe, it } from "vitest";

// The deep bench (16 tasks on a fake desktop) — the regression check every assistant task runs.
// Spends model credits, so it only runs when BENCH names a model, e.g.
//   BENCH=bedrock:us.moonshotai.kimi-k3.1 BENCH_VARIANT=check BENCH_TASKS=all npx vitest run bench/deep.test.ts
const spec = process.env.BENCH;

describe.skipIf(!spec)("deep bench", () => {
  it("runs the selected tasks", async () => {
    // @ts-expect-error — plain JS bench module, no types
    const { runDeep } = await import("./deep.mjs");
    const rows: { pass: boolean }[] = await runDeep({
      spec,
      variant: process.env.BENCH_VARIANT ?? "check",
      only: process.env.BENCH_TASKS ?? "all",
      repeats: Number(process.env.BENCH_REPEATS ?? 1),
    });
    console.log(`BENCH ${spec}: ${rows.filter((r) => r.pass).length}/${rows.length} passed`);
  }, 3_600_000);
});
