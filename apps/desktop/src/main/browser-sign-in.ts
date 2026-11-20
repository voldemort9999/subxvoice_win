// Sign in with Google, in the user's own browser (RFC 8252, "OAuth for native apps"): the app opens
// Cognito's sign-in address, which hands over to Google; Google sends the browser back to a port on
// this PC that the app listens on for those few moments, with a one-time code the app swaps for
// tokens. The browser is where the user is already signed in to Google, and the app never sees the
// Google password. PKCE ties the code to this app, so another program catching it gets nothing.

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { shell } from "electron";

/** Registered as callback URLs on the Cognito app client; the first one free is used. */
const PORTS = [47821, 47822, 47823];
/** Long enough to pick an account and pass a second factor; then the attempt is abandoned. */
const WAIT_MS = 5 * 60_000;

/**
 * Cognito's answer to the first Google sign-in for an email that has an account: it links the two
 * and refuses this one attempt. Asking again signs in.
 */
export class LinkedJustNow extends Error {}

export interface BrowserTokens {
  AccessToken: string;
  IdToken: string;
  RefreshToken: string;
  ExpiresIn: number;
}

export async function signInInBrowser(options: {
  /** Cognito's sign-in address, e.g. https://auth.subxvoice.app */
  domain: string;
  clientId: string;
  provider: "Google";
  /** Google's account list, instead of going on with the account the browser already has. */
  chooseAccount: boolean;
}): Promise<BrowserTokens> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  const { server, port } = await listen();
  const redirectUri = `http://localhost:${port}/callback`;
  // The tab that brought the code back waits for its page until the sign-in has finished, so it
  // can say which account is now signed in.
  const tab: { held: ServerResponse | null } = { held: null };

  try {
    const code = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Google sign-in took too long. Try again.")), WAIT_MS);
      server.on("request", (request, response) => {
        const url = new URL(request.url ?? "/", redirectUri);
        if (url.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }
        const failure = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        const got = url.searchParams.get("code");
        // A code meant for another attempt (or another program) is refused.
        const ok = !failure && got && url.searchParams.get("state") === state;
        const linking = !!failure && /already found an entry/i.test(failure);
        // Only the first good callback waits; a reload of that tab gets an answer straight away.
        if (ok && !tab.held) tab.held = response;
        else if (ok)
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("done"));
        else
          response
            .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
            .end(page(linking ? "linking" : "failed"));
        clearTimeout(timer);
        if (ok) resolve(got);
        else {
          if (failure && /already found an entry/i.test(failure)) reject(new LinkedJustNow());
          else {
            if (failure) console.error("google sign-in:", failure);
            reject(new Error(googleProblem(failure)));
          }
        }
      });
    });

    const authorize = new URL("/oauth2/authorize", options.domain);
    authorize.search = new URLSearchParams({
      identity_provider: options.provider,
      client_id: options.clientId,
      response_type: "code",
      // The last lets this token save the user's own name, as a password sign-in's token can.
      scope: "openid email profile aws.cognito.signin.user.admin",
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      // "Switch account" (or no account remembered on this Mac): Google's list, so the user picks.
      // "Continue as …": none, so Google goes on with the account it has open. Cognito does not pass
      // login_hint on to Google (tested 2026-11-20), so the remembered account cannot be named.
      ...(options.chooseAccount ? { prompt: "select_account" } : {}),
    }).toString();
    await shell.openExternal(authorize.toString());

    const response = await fetch(new URL("/oauth2/token", options.domain), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: options.clientId,
        code: await code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new Error("Can't reach the sign-in service. Check your connection.");
    });
    const tokens = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof tokens.access_token !== "string" || typeof tokens.id_token !== "string") {
      throw new Error("Google sign-in didn't finish. Try again.");
    }
    tab.held
      ?.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(page("done", emailIn(tokens.id_token)));
    tab.held = null;
    return {
      AccessToken: tokens.access_token,
      IdToken: tokens.id_token,
      RefreshToken: String(tokens.refresh_token ?? ""),
      ExpiresIn: Number(tokens.expires_in ?? 3600),
    };
  } finally {
    // A tab still waiting means the sign-in failed after the code came back.
    tab.held?.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("failed"));
    server.close();
  }
}

/** The address in an ID token that just came from Cognito over TLS; only shown, never trusted. */
function emailIn(idToken: string): string {
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof claims.email === "string" ? claims.email : "";
  } catch {
    return "";
  }
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/**
 * What a failed Google sign-in means, in words. Cognito passes Google's refusal on as
 * "Error response from Identity Provider; error=…", which nobody should have to read.
 */
function googleProblem(failure: string | null): string {
  if (failure && /access_denied/.test(failure)) {
    return "Google didn't sign you in. If you closed the Google page, try again; otherwise sign in with email for now.";
  }
  return "Google sign-in didn't finish. Try again, or sign in with email.";
}

/** The first of the registered ports that is free, on this PC only. */
async function listen(): Promise<{ server: Server; port: number }> {
  for (const port of PORTS) {
    const server = createServer();
    const opened = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (opened) return { server, port };
  }
  throw new Error("Google sign-in couldn't start: close other apps using ports 47821–47823 and try again.");
}

/** What the browser tab shows once it has handed the code back: which account, in our own look. */
function page(outcome: "done" | "linking" | "failed", email = ""): string {
  const { title, body } = {
    done: {
      title: "You're signed in",
      body: "Go back to SUBXVoice. You can close this tab.",
    },
    // The first Google sign-in for an email that has an account: linked now, finished in a new tab.
    linking: { title: "Almost there", body: "Your Google account is now linked. Finishing in a new tab…" },
    failed: { title: "Sign-in didn't finish", body: "Go back to SUBXVoice and try again." },
  }[outcome];
  const signedIn = outcome === "done" && email;
  const account = signedIn
    ? `<div class="account"><span class="dot">${escapeHtml(email.slice(0, 1).toUpperCase())}</span><span><small>Signed in as</small><b>${escapeHtml(email)}</b></span></div>`
    : "";
  const other = signedIn
    ? `<p class="switch">Not the right account? In SUBXVoice, sign out, then continue with Google again and pick another.</p>`
    : "";
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SUBXVoice</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161412;color:#f2e8c8;font:16px/1.5 -apple-system,system-ui,sans-serif}
main{width:min(420px,calc(100vw - 48px))}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:17px;margin-bottom:34px}
.brand b{font-weight:800}
h1{font-size:28px;letter-spacing:-.02em;margin:0 0 8px}
p{margin:0;color:rgba(242,232,200,.66)}
.account{display:flex;align-items:center;gap:14px;margin:26px 0 18px;padding:16px 18px;border-radius:16px;background:#211e1a;border:1px solid rgba(242,232,200,.08)}
.dot{width:40px;height:40px;border-radius:20px;display:grid;place-items:center;background:#6b7cff;color:#161412;font-weight:700;font-size:18px;flex:none}
.account small{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:rgba(242,232,200,.5)}
.account b{display:block;font-size:16px;word-break:break-all}
.switch{font-size:14px;margin-top:22px;padding-top:18px;border-top:1px solid rgba(242,232,200,.08)}
i{display:block;width:44px;height:4px;border-radius:2px;background:#6b7cff;margin:0 0 22px}
</style>
<main><div class="brand"><svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="22" fill="#2a2621"/><line x1="27" y1="27" x2="73" y2="73" stroke="#f2e8c8" stroke-width="8" stroke-linecap="round"/><path d="M27 73 C 24 60, 40 62, 50 50 S 76 40, 73 27" fill="none" stroke="#6b7cff" stroke-width="8" stroke-linecap="round"/></svg><span>SUB<b>X</b>Voice</span></div>
<i></i><h1>${title}</h1>${account}<p>${body}</p>${other}</main>`;
}
