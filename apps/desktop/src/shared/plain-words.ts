// Every error the app shows passes through here: our own sentences go on screen as they are, and
// anything written for us instead (a status code, an internal name, a vendor, a system error) is
// replaced by a plain sentence. The original is still logged, where we can read it.

/**
 * Signs that a message was not written for people. Our own sentences never contain these: no
 * underscores (internal names such as `right_ctrl` or `upstream_unavailable`), no HTTP status in
 * brackets, no system error names, no vendors or AWS services, no code or JSON.
 */
const INTERNAL = [
  /\b\w+_\w+\b/, // internal names: mic_start, upstream_unavailable, right_ctrl
  /\(\s*[1-5]\d\d\s*\)|\b(?:status|HTTP|code)\s*:?\s*[1-5]\d\d\b|\b[1-5]\d\d\s*:/i, // "(502)", "status 402", "402:"
  /\bE[A-Z]{3,}\b/, // ECONNRESET, ENOTFOUND, ETIMEDOUT, EACCES
  /fetch failed|socket hang up|Unexpected server response|network ?error/i,
  /\b\w*(?:Exception|Error)\b(?!\s+(?:on|in)\b)/, // TypeError, NotAuthorizedException, "Error Domain=…"
  /Error Domain|OSStatus|stack trace|\bat \w+ \(/,
  /\b(?:undefined|null|NaN)\b|\[object /,
  /[{}<>]|=>/,
  /https?:\/\//,
  /\b(?:Cognito|Soniox|Celeris|OpenRouter|Lambda|AWS|KMS|SES|Supabase|Postgres|DynamoDB|Electron|Node)\b/,
  /\bMac helper\b|Unknown command|Could not parse/i,
];

/** True when a message reads as written for the person using the app. */
export function forPeople(message: string): boolean {
  const text = message.trim();
  return text.length > 0 && text.length <= 300 && !INTERNAL.some((sign) => sign.test(text));
}

/** The message if it is written for people; otherwise the plain fallback. */
export function plainWords(message: string, fallback: string): string {
  return forPeople(message) ? message.trim() : fallback;
}
