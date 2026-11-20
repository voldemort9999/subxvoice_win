import type { Platform } from "@subx/core";
import { shell } from "electron";
import { WinCommandSource } from "./commands";
import { WinContextReader } from "./context";
import { WinAudioFeedback } from "./feedback";
import { WinFieldReader } from "./field";
import { WinHotkey } from "./hotkey";
import { WinInserter } from "./inserter";
import { isOwnInput, ownInputEndedAt } from "./own-input";
import { WinPermissions } from "./permissions";
import { WinUserInputWatch } from "./touch";
import { foregroundHandle, playWave, pressedKeys } from "./win32";

export function createWinPlatform(): Platform {
  const inserter = new WinInserter();
  const commands = new WinCommandSource({ inserter, openUrl: (url) => shell.openExternal(url) });
  const hotkey = new WinHotkey();
  return {
    os: "win",
    hotkey,
    inserter,
    permissions: new WinPermissions(),
    context: new WinContextReader(),
    field: new WinFieldReader({
      read: () => commands.probe.focusedText(),
      foreground: foregroundHandle,
    }),
    feedback: new WinAudioFeedback({
      play: playWave,
      isMuted: () => commands.outputMuted(),
      setMuted: (on) => commands.setOutputMuted(on),
    }),
    // The Mac app's menu and Home open apps and links through this; on Windows it is the same
    // open_app action the assistant uses.
    desktop: {
      openApp: async (name) => {
        const action = (await commands.actions()).find((a) => a.id === "open_app");
        await action?.run({ name });
      },
      openUrl: (url) => shell.openExternal(url),
    },
    // Nothing starts here: PowerShell is spawned on the first command, so the cost is never paid
    // by someone who only dictates.
    commands,
    screen: commands.screen,
    screenControl: {
      capture: commands.capture,
      input: commands.input,
      probe: commands.probe,
      // The executor's own input, the app's hotkeys and a landing dictation are not the user
      // using the PC (touch.ts, review I8).
      watch: (dictationActive) =>
        new WinUserInputWatch({
          injectedAt: () => commands.input.lastInjectedAt(),
          own: isOwnInput,
          ownEndedAt: () => ownInputEndedAt(),
          chordHeld: () => hotkey.chordHeld(),
          chordChangedAt: () => hotkey.chordChangedAt(),
          dictationActive,
          // Only a press or a window switch counts, not the mouse moving (touch.ts upsets()).
          pressed: pressedKeys,
          foreground: foregroundHandle,
        }),
    },
  };
}
