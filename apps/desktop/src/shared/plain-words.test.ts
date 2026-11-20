import { describe, expect, it } from "vitest";
import { forPeople, plainWords } from "./plain-words";

describe("what an error may show", () => {
  // Real sentences from the app: all of them must go on screen unchanged.
  it("lets our own sentences through", () => {
    for (const text of [
      "You've used today's dictation time. It resets tomorrow.",
      "Can't reach SUBXVoice. Check your internet connection.",
      "That's 3 codes in 10 minutes. Try again in a few minutes, or continue with Google.",
      "Allow Input Monitoring for SUBXVoice so it can detect the hotkey.",
      "No microphone found. Connect one, or pick another in Settings.",
      "Your account is ready. In a minute, press Resend code to get your sign-in code.",
      "Enter the email address in lowercase.",
      "Couldn't check for updates. Check your connection and try again.",
      "Your instructions can be up to 500 characters.",
      "That took too long — try again",
    ])
      expect(forPeople(text), text).toBe(true);
  });

  it("keeps codes, internal names, vendors and system errors off the screen", () => {
    for (const text of [
      "Something went wrong on our side (502). Try again in a moment.",
      "rewrite 402: insufficient credit",
      "upstream_unavailable",
      'Mac helper did not answer "mic_start"',
      "Unsupported hotkey: right_ctrl",
      "fetch failed",
      "connect ECONNRESET 13.235.1.1:443",
      "NotAuthorizedException: Invalid session for the user",
      "TypeError: Cannot read properties of undefined (reading 'text')",
      "Error Domain=com.apple.coreaudio.avfaudio Code=-10868",
      "Speech-to-text: Soniox closed the connection",
      'Could not parse command: {"cmd":',
      "",
    ])
      expect(forPeople(text), text).toBe(false);
    expect(plainWords("fetch failed", "Try again.")).toBe("Try again.");
  });
});
