import type { Focus, OcrLine, ScreenProbe, UiNode } from "@subx/core";
import type { PowerShellWorker } from "./powershell";

/** The band read around a click for OCR: a button's label sits within it, its neighbours mostly not. */
const OCR_WIDTH = 480;
const OCR_HEIGHT = 160;

/** What the assistant's guard looks at before a pixel action (CmdProbe and Invoke-SubxOcr in interop.ts). */
export class WinScreenProbe implements ScreenProbe {
  constructor(private readonly worker: PowerShellWorker) {}

  elementAt(x: number, y: number): Promise<UiNode[]> {
    return this.worker.json<UiNode[]>(`[CmdProbe]::At(${Math.round(x)}, ${Math.round(y)})`);
  }

  async focused(): Promise<Focus | null> {
    return (await this.worker.json<Focus | null>("[CmdProbe]::Focused()")) ?? null;
  }

  /** The focused box's text, null for none or a password box (field.ts, auto-learn). */
  async focusedText(): Promise<string | null> {
    return (await this.worker.json<string | null>("[CmdProbe]::FocusedText()")) ?? null;
  }

  textNear(x: number, y: number): Promise<OcrLine[]> {
    const left = Math.round(x - OCR_WIDTH / 2);
    const top = Math.round(y - OCR_HEIGHT / 2);
    return this.worker.json<OcrLine[]>(`Invoke-SubxOcr ${left} ${top} ${OCR_WIDTH} ${OCR_HEIGHT}`);
  }
}
