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
        else if (ok) sendTo(response, "done");
        else sendTo(response, linking ? "linking" : "failed");
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
    if (tab.held) sendTo(tab.held, "done");
    tab.held = null;
    return {
      AccessToken: tokens.access_token,
      IdToken: tokens.id_token,
      RefreshToken: String(tokens.refresh_token ?? ""),
      ExpiresIn: Number(tokens.expires_in ?? 3600),
    };
  } finally {
    // A tab still waiting means the sign-in failed after the code came back.
    if (tab.held) sendTo(tab.held, "failed");
    server.close();
  }
}

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
  throw new Error("Google sign-in couldn't start: close other apps using ports 47821-47823 and try again.");
}

/**
 * Where the browser tab goes once the code is here: a page on our website, so the tab shows
 * subxvoice.app/signed-in rather than this Mac's http://localhost:47821/callback?code=… (the code
 * is useless without the verifier, which never leaves the app, but nobody should have to read it).
 */
const SIGNED_IN_PAGE = "https://subxvoice.app/signed-in/";

function sendTo(response: ServerResponse, outcome: "done" | "linking" | "failed"): void {
  const where = outcome === "done" ? SIGNED_IN_PAGE : `${SIGNED_IN_PAGE}?r=${outcome}`;
  response.writeHead(302, { Location: where, "Cache-Control": "no-store" }).end();
}
