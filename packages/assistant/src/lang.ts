/**
 * The harness's own lines — the stop question, a parked task, an approval's "what" and "why", the
 * ending when something failed — in the language the user spoke (design §6b; user, 2026-11-18:
 * "Hindi mein baat karna start kar doon to Hindi mein kare, English mein rahoon to English mein").
 * The model already answers in the user's language; these lines are the harness's, so they follow
 * the request too. Hindi means Hindi or Hinglish; the lines are Roman Hinglish, as the app writes.
 */
export type Lang = "hi" | "en";

/** Common Hinglish words: one of them in a Roman request means the user is speaking Hindi. */
const HINGLISH =
  /\b(karo|kar|dena|hai|hain|ho|ko|ki|ka|ke|mein|pe|par|se|aur|bhi|ye|yeh|wo|woh|kya|kab|kahan|nahi|nahin|mat|haan|abhi|kholo|likho|bhejo|chalao|band|dhoondo|dhundho|dikhao|batao|lagao|bajao|ruko|ruk|jao|wala|wali|kitna|kaise)\b/i;

export function languageOf(text: string): Lang {
  if (/[ऀ-ॿ]/.test(text.replace(/[।॥]/g, ""))) return "hi";
  return HINGLISH.test(text) ? "hi" : "en";
}

const LINES = {
  hi: {
    working: "Samajh raha hoon…",
    stopQuestion: "Theek hai, ruk gaya. Ise poora band kar doon, ya continue karun?",
    stopChoices: ["Band kar do", "Continue"],
    touchQuestion: "Aapko kaam hai? Main baad mein kar loonga — abhi continue karun?",
    touchChoices: ["Continue", "Baad mein"],
    stopped: (sofar: string) => `Band kar diya. ${sofar ? `Tab tak: ${sofar}.` : "Kuch nahi hua tha."}`,
    parked: (what: string) => `Ruka hua kaam: ${what}`,
    capped: (limit: "cost" | "turns", sofar: string) =>
      `Ek command ki ${limit === "cost" ? "kharch" : "turns"} limit poori ho gayi, isliye rok diya. ${sofar ? `Tab tak: ${sofar}.` : "Kuch nahi hua tha."}`,
    noModel: (why: string) => `Model se baat nahi ho payi: ${why}`,
    garbled: "Model ka jawab samajh nahi aaya, isliye rok diya.",
    risky: "Isse kuch bheja, khareeda, book ya hataya ja sakta hai.",
    press: (label: string) => `"${label}" dabana`,
    pressEnter: (where: string) => `${where} mein Enter dabana (message chala jayega)`,
    sendTo: (to: string, text: string) => `WhatsApp pe ${to} ko "${text}" bhejna`,
    closeKey: (window: string, combo: string) => `"${window}" band karna (${combo})`,
    unreadClick: "is jagah click karna (screen padh nahi paya)",
  },
  en: {
    working: "Working on it…",
    stopQuestion: "Okay, paused. Stop this completely, or continue?",
    stopChoices: ["Stop", "Continue"],
    touchQuestion: "Do you need the PC? I can do this later — continue now?",
    touchChoices: ["Continue", "Later"],
    stopped: (sofar: string) => `Stopped. ${sofar ? `Done so far: ${sofar}.` : "Nothing had been done."}`,
    parked: (what: string) => `Paused task: ${what}`,
    capped: (limit: "cost" | "turns", sofar: string) =>
      `Stopped: this command reached its ${limit} limit. ${sofar ? `Done so far: ${sofar}.` : "Nothing had been done."}`,
    noModel: (why: string) => `Couldn't reach the model: ${why}`,
    garbled: "Stopped: the model's reply could not be understood.",
    risky: "This could send, buy, book or delete something.",
    press: (label: string) => `Press "${label}"`,
    pressEnter: (where: string) => `Press Enter in ${where} (the message will be sent)`,
    sendTo: (to: string, text: string) => `Send "${text}" to ${to} on WhatsApp`,
    closeKey: (window: string, combo: string) => `Close "${window}" (${combo})`,
    unreadClick: "Click here (the screen could not be read)",
  },
} as const;

/**
 * The words the harness listens for (stop, yes, no, continue), Devanagari → Roman, so one set of
 * patterns hears both: speech recognition writes "रुक जाओ" as often as "ruk jao", and JavaScript's
 * \b never matches next to Devanagari — "ruko" in Devanagari never stopped a run (S-024).
 * ponytail: a word list, not transliteration; add a word when a log shows it missed.
 */
const ROMAN: Record<string, string> = {
  रुक: "ruk",
  रुको: "ruko",
  रुकिए: "rukiye",
  रुकना: "rukna",
  जाओ: "jao",
  जा: "ja",
  बंद: "band",
  करो: "karo",
  कर: "kar",
  दो: "do",
  बस: "bas",
  कुछ: "kuch",
  मत: "mat",
  नहीं: "nahi",
  नही: "nahi",
  ना: "na",
  न: "na",
  हाँ: "haan",
  हां: "haan",
  हा: "ha",
  जी: "ji",
  ठीक: "theek",
  भेज: "bhej",
  भेजो: "bhejo",
  चलो: "chalo",
  स्टॉप: "stop",
  कैंसल: "cancel",
  ओके: "ok",
  रहने: "rehne",
  छोड़ो: "chhodo",
  खत्म: "khatam",
  आगे: "aage",
  चालू: "chalu",
  जारी: "jaari",
  करते: "karte",
  रहो: "raho",
  कंटिन्यू: "continue",
  बाद: "baad",
};

export function romanWords(text: string): string {
  return text.replace(/[\p{L}\p{M}]+/gu, (word) => ROMAN[word] ?? word);
}

// ponytail: one language for the whole process — Follow My Words runs one command at a time
// (apps/desktop follow.ts). Pass it per run if runs ever overlap.
let current: Lang = "hi";

export function setLanguage(lang: Lang): void {
  current = lang;
}

export function say(): (typeof LINES)[Lang] {
  return LINES[current];
}
