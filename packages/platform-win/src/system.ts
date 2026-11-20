import { type FocusInfo, takesText } from "./focus";
import { INTEROP } from "./interop";
import { PowerShellWorker } from "./powershell";

/**
 * What dictation needs from Windows' COM APIs, on one PowerShell worker started the first time it
 * is asked for (never at app start): the output mute (feedback.ts) and the focused box's text
 * (field.ts).
 */
export class WinSystem {
  private readonly worker = new PowerShellWorker(INTEROP);

  async outputMuted(): Promise<boolean> {
    return (await this.worker.json<{ muted: boolean }>("[CmcpAudio]::Volume(0)")).muted;
  }

  async setOutputMuted(on: boolean): Promise<void> {
    await this.worker.run(`[CmcpAudio]::SetMute(0, $${on})`);
  }

  /** The focused box's text; null when nothing readable has the focus, and always for a password box. */
  async focusedText(): Promise<string | null> {
    return (await this.worker.json<string | null>("[CmdField]::FocusedText()")) ?? null;
  }

  /** What kind of element has the focus (never its text); null when nothing has. */
  async focusInfo(): Promise<FocusInfo | null> {
    const info = await this.worker.json<FocusInfo | null>("[CmdField]::FocusInfo()");
    return info && typeof info === "object" && !Array.isArray(info) ? info : null;
  }

  /** Whether the focus takes typed text: false only when it clearly does not, null when unsure. */
  async focusTakesText(): Promise<boolean | null> {
    return takesText(await this.focusInfo());
  }

  /**
   * At key-down: starts the worker (compiling the C#) and asks about the focus once, because
   * Chromium builds its accessibility tree only when asked; by key-up the answer is the real one.
   */
  warm(): void {
    void this.focusInfo().catch(() => {});
  }

  dispose(): void {
    this.worker.dispose();
  }
}
