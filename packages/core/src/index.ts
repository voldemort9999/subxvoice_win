// What Follow My Words' assistant and the Windows platform still use of the old command mode: the
// direct-action and screen types, and the nearest-match lookup (Mac UI port, 2026-11-19).
export { closest, type Match, type MatchHow, resolveOne } from "./agent/match";
export type {
  ActionSource,
  AgentAction,
  ScreenAction,
  ScreenDriver,
  ScreenElement,
  ScreenLook,
  ScreenSnapshot,
} from "./agent/types";
export type * from "./contracts";
export { type ErrorCode, notImplemented, SubxError } from "./errors";
export { editsIn, type LearnedWord, learnFromEdit, mergeLearned } from "./learn";
export {
  type DictationSession,
  type Outcome,
  Pipeline,
  type PipelineDeps,
  type ProcessOptions,
} from "./pipeline";
export { applyDictionary } from "./rules";
export type * from "./types";
