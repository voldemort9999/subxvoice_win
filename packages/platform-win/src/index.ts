import { spawn } from "node:child_process";
import type { Platform } from "@subx/core";
import { shell } from "electron";
import { WinContextReader } from "./context";
import { WinAudioFeedback } from "./feedback";
import { WinFieldReader } from "./field";
import { WinHotkey } from "./hotkey";
import { WinInserter } from "./inserter";
import { WinPermissions } from "./permissions";
import { WinSystem } from "./system";
import { foregroundHandle, playWave, writePrivateClipboardText } from "./win32";

/** The Windows plug, for the same contract the Mac app's platform-mac fills. */
export function createWinPlatform(): Platform {
  // PowerShell starts the first time the mute or the box reader is needed, never at app start.
  const system = new WinSystem();
  return {
    os: "win",
    hotkey: new WinHotkey(),
    // Pastes only where text can go; elsewhere the pill offers Copy (the Mac app's rule).
    inserter: new WinInserter({
      writePrivate: writePrivateClipboardText,
      focusTakesText: () => system.focusTakesText(),
      warm: () => system.warm(),
      // Read back after pasting: where the box can be read, the words must be in it.
      readField: () => system.focusedText(),
    }),
    permissions: new WinPermissions(),
    context: new WinContextReader((path) => system.fileDescription(path)),
    field: new WinFieldReader({ read: () => system.focusedText(), foreground: foregroundHandle }),
    feedback: new WinAudioFeedback({
      play: playWave,
      isMuted: () => system.outputMuted(),
      setMuted: (on) => system.setOutputMuted(on),
    }),
    desktop: {
      // `start` resolves an app name, a path or a link the way the Run box does.
      openApp: async (name) => {
        spawn("cmd.exe", ["/c", "start", "", name], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        }).unref();
      },
      openUrl: (url) => shell.openExternal(url),
    },
  };
}
