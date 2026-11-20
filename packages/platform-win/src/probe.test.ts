import { describe, expect, it } from "vitest";
import type { PowerShellWorker } from "./powershell";
import { WinScreenProbe } from "./probe";

function fakeWorker(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const worker = {
    async json<T>(code: string): Promise<T> {
      calls.push(code);
      const key = Object.keys(answers).find((prefix) => code.startsWith(prefix));
      if (!key) throw new Error(`unexpected ${code}`);
      return answers[key] as T;
    },
  } as unknown as PowerShellWorker;
  return { worker, calls };
}

describe("WinScreenProbe", () => {
  it("asks UIA for the element chain at a physical point", async () => {
    const { worker, calls } = fakeWorker({ "[CmdProbe]::At(": [{ role: "Button", name: "Send" }] });
    expect(await new WinScreenProbe(worker).elementAt(-1720, 200)).toEqual([
      { role: "Button", name: "Send" },
    ]);
    expect(calls).toEqual(["[CmdProbe]::At(-1720, 200)"]);
  });

  it("reads OCR from a band around the point", async () => {
    const lines = [{ text: "Place order", box: { x: 900, y: 590, width: 150, height: 30 } }];
    const { worker, calls } = fakeWorker({ "Invoke-SubxOcr": lines });
    expect(await new WinScreenProbe(worker).textNear(1000, 600)).toEqual(lines);
    expect(calls).toEqual(["Invoke-SubxOcr 760 520 480 160"]);
  });

  it("passes the focus through, and null when nothing has it", async () => {
    const focus = { role: "Edit", name: "", help: "Type a message", window: "WhatsApp", program: "WhatsApp" };
    expect(await new WinScreenProbe(fakeWorker({ "[CmdProbe]::Focused(": focus }).worker).focused()).toEqual(
      focus,
    );
    expect(
      await new WinScreenProbe(fakeWorker({ "[CmdProbe]::Focused(": null }).worker).focused(),
    ).toBeNull();
  });
});
