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

  dispose(): void {
    this.worker.dispose();
  }
}
