import type { StyleCategory, WritingStyle } from "../../../shared/ipc";

/**
 * The three ways SUBXVoice can write, exactly the server's styles (`subxvoice-api` src/rewrite.ts),
 * each shown on the same sentence so the difference is seen rather than named.
 */
export const STYLE_OPTIONS: { value: WritingStyle; label: string; hint: string }[] = [
  {
    value: "formal",
    label: "Formal",
    hint: "Full sentences, capitals and full stops. “Can you send the report by Friday? Thanks.”",
  },
  {
    value: "casual",
    label: "Casual",
    hint: "Natural chat, no full stop at the end. “Can you send the report by Friday, thanks”",
  },
  {
    value: "very_casual",
    label: "Very casual",
    hint: "Like texting a friend, all lowercase. “can you send the report by friday, thanks”",
  },
];

/** The kinds of app a style is chosen for, with apps people will recognise. */
export const STYLE_CATEGORIES: { id: StyleCategory; label: string; apps: string }[] = [
  { id: "personal", label: "Personal chats", apps: "Messages, WhatsApp, Telegram" },
  { id: "work", label: "Work chats", apps: "Slack, Teams, Discord" },
  { id: "email", label: "Email", apps: "Mail, Gmail, Outlook" },
  { id: "other", label: "Everything else", apps: "Notes, documents, code" },
];

/** The server's defaults, used until the account's own settings have loaded. */
export const DEFAULT_STYLES: Record<StyleCategory, WritingStyle> = {
  personal: "casual",
  work: "casual",
  email: "formal",
  other: "formal",
};
