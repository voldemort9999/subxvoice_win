import type { Note, ScriptSettings } from "../../../shared/ipc";
import { formatCount } from "../shared/format";

/** A new script starts from the settings last used, as the Mac's does (kept per PC). */
const LAST = "subx.prompter.last";

export const DEFAULT_SETTINGS: ScriptSettings = {
  withVoice: false,
  keepUp: 1,
  sensitivity: 0.5,
  size: 20,
  hidden: true,
};

export function lastSettings(): ScriptSettings {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(localStorage.getItem(LAST) ?? "{}") as Partial<ScriptSettings>),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function rememberSettings(settings: ScriptSettings): void {
  try {
    localStorage.setItem(LAST, JSON.stringify(settings));
  } catch {
    // Not remembered: a new script starts from the defaults.
  }
}

/** A script's own settings; one that never had any takes those last used. */
export function settingsOf(script: Note | undefined): ScriptSettings {
  return { ...lastSettings(), ...(script?.settings as Partial<ScriptSettings> | undefined) };
}

const wordSegments = new Intl.Segmenter(undefined, { granularity: "word" });

/** Words in a script, in any language: Chinese, Japanese and Thai are not split by spaces. */
export function wordsIn(text: string): number {
  let count = 0;
  for (const part of wordSegments.segment(text)) if (part.isWordLike) count += 1;
  return count;
}

/** At about 140 words a minute, read aloud. */
export function minutes(words: number): string {
  const m = words / 140;
  return m < 1 ? "under a minute" : `about ${Math.round(m)} min`;
}

export function lengthOf(text: string): string {
  const words = wordsIn(text);
  return `${formatCount(words)} ${words === 1 ? "word" : "words"}, ${minutes(words)}`;
}

/** A new script at the top of the list, opened in its window to write in. */
export async function newScript(text = ""): Promise<void> {
  const id = crypto.randomUUID();
  await window.subx.notes.save("script", { id, text, settings: { ...lastSettings() } });
  window.subx.prompter.openScript(id);
}
