// Names and flags for the languages the backend says it can hear. The list itself comes from the
// server (`/v1/languages`); only how to show a code lives here.

/** The country whose flag stands for a language: where most of its speakers are, by convention. */
const FLAG_COUNTRY: Record<string, string> = {
  af: "ZA",
  sq: "AL",
  ar: "SA",
  az: "AZ",
  eu: "ES",
  be: "BY",
  bn: "BD",
  bs: "BA",
  bg: "BG",
  ca: "ES",
  zh: "CN",
  hr: "HR",
  cs: "CZ",
  da: "DK",
  nl: "NL",
  en: "US",
  et: "EE",
  fi: "FI",
  fr: "FR",
  gl: "ES",
  de: "DE",
  el: "GR",
  gu: "IN",
  he: "IL",
  hi: "IN",
  hu: "HU",
  id: "ID",
  it: "IT",
  ja: "JP",
  kn: "IN",
  kk: "KZ",
  ko: "KR",
  lv: "LV",
  lt: "LT",
  mk: "MK",
  ms: "MY",
  ml: "IN",
  mr: "IN",
  no: "NO",
  fa: "IR",
  pl: "PL",
  pt: "BR",
  pa: "IN",
  ro: "RO",
  ru: "RU",
  sr: "RS",
  sk: "SK",
  sl: "SI",
  es: "ES",
  sw: "KE",
  sv: "SE",
  tl: "PH",
  ta: "IN",
  te: "IN",
  th: "TH",
  tr: "TR",
  uk: "UA",
  ur: "PK",
  vi: "VN",
  cy: "GB",
};

/** A flag emoji from two regional-indicator letters. */
export function flag(code: string): string {
  const country = FLAG_COUNTRY[code];
  if (!country) return "🌐";
  return String.fromCodePoint(...[...country].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));
}

const english = new Intl.DisplayNames(["en"], { type: "language" });

/** "Hindi", in English, for the list. */
export const languageName = (code: string) => english.of(code) ?? code;

/** "हिन्दी", in the language itself, so a speaker finds their own language by sight. */
export function nativeName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? "";
  } catch {
    return "";
  }
}
