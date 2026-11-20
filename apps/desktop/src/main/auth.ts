import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { CodeSent, LastGoogleAccount } from "../shared/ipc";
import { LinkedJustNow, signInInBrowser } from "./browser-sign-in";
import { CodePacing } from "./code-pacing";
import { clientHeaders } from "./providers";

/**
 * Who the user is, and the token our server checks: Amazon Cognito, the pool `subxvoice-api`
 * verifies (`ap-south-1`). The pool id and this app's client id are not secrets: the client has no
 * secret, by design, because anything shipped in an app can be read out of it.
 *
 * Plain HTTPS to Cognito's API rather than the AWS SDK: five calls, and the SDK would add megabytes
 * to the app for them.
 */
const REGION = "ap-south-1";
// `subxvoice-win`, the Windows app's own client in the pool (the Mac's is 74nrlfg9lfkkqskhasdi9ukkoo).
const CLIENT_ID = "4cpl86hcdtap87i8au51mungr6";
const COGNITO_URL = `https://cognito-idp.${REGION}.amazonaws.com/`;
/** Cognito's own sign-in pages, which hand over to Google. */
const SIGN_IN_DOMAIN = "https://auth.subxvoice.app";

/** Renew this long before the access token runs out, so a dictation never starts with a dying one. */
const RENEW_BEFORE_MS = 2 * 60_000;

export interface AccountState {
  /** The account's id (Cognito `sub`), used to keep each account's data apart on disk. */
  id: string | null;
  email: string | null;
  signedIn: boolean;
  /** What the user asked to be called. Empty until they finish setting up. */
  name: string;
  /** False until the name has been chosen once. */
  onboarded: boolean;
  /** A name to offer in setup (the first name Google gave), or "". */
  suggestedName: string;
  /** The Google profile photo as a data: URL, or "" (the round initial is shown). */
  photo: string;
  /** Signed out: the Google account last used here, or null. */
  lastGoogle: LastGoogleAccount | null;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working, in ms. */
  expiresAt: number;
  id: string;
  email: string;
  name: string;
  /** From Google: the first name, offered in setup so the user only has to confirm it. */
  givenName?: string;
  /** The Google profile photo as a data: URL, fetched once (the app's pages load nothing remote). */
  photo?: string;
  /** The account has Google linked (the ID token lists it), so a sign-out offers "Continue as …". */
  google?: boolean;
}

/** What is kept on disk: enough to renew the session, and to know whose data to show offline. */
type Saved = Pick<Session, "refreshToken" | "id" | "email" | "name" | "photo">;

/**
 * Only the refresh token (with who it belongs to) is kept on disk, encrypted by the macOS
 * keychain; the access token lives in memory and is renewed from it.
 */
export class Account {
  private readonly file: string;
  /** The last Google account, kept through a sign-out so the next sign-in is one press. */
  private readonly lastGoogleFile: string;
  private lastGoogle: LastGoogleAccount | null | undefined;
  private session: Session | null = null;
  private renewing: Promise<void> | null = null;
  private lostAtStart: string | null = null;
  /**
   * A sign-in waiting for the code just emailed. "new": an account was just created (or never
   * confirmed) and the code confirms it; "existing": the code signs in. `session` is Cognito's
   * handle on the attempt.
   */
  private pending: { email: string; kind: "new" | "existing"; session?: string } | null = null;
  private readonly pacing = new CodePacing();
  private listeners = new Set<(state: AccountState) => void>();

  /**
   * `devToken` (development only, from SUBX_DEV_TOKEN): the app counts as signed in to a local test
   * account and sends that token to a local server. The packaged app never takes this path.
   */
  constructor(
    private readonly apiUrl: string,
    private readonly devToken?: string,
  ) {
    this.file = join(app.getPath("userData"), "session.bin");
    this.lastGoogleFile = join(app.getPath("userData"), "last-google.bin");
  }

  /** Restores the last session, if the machine still has one. Safe to call when it does not. */
  async restore(): Promise<void> {
    if (this.devToken) return;
    const saved = await this.readSaved();
    if (!saved) return;
    // Signed in as far as this Mac knows, until Cognito says otherwise: offline at launch is not a
    // sign-out, and the token is renewed on the first dictation instead.
    this.session = { ...saved, accessToken: "", expiresAt: 0 };
    try {
      await this.renew(saved.refreshToken);
    } catch (error) {
      if (error instanceof CognitoError) {
        this.session = null;
        await this.forget();
        this.lostAtStart = saved.id || null;
      }
    }
  }

  /**
   * The account this Mac was signed in as until Cognito refused its session at start (the sign-in
   * ran out). Its local data's 30 days start now, not from when the app was last open: signing in
   * again must find the history still there (account-cleanup.ts).
   */
  signedOutAtStart(): string | null {
    return this.lostAtStart;
  }

  /**
   * "Continue with email": one step for new and existing accounts alike, as the user cannot be
   * expected to remember which they have. A new address gets an account and a code that confirms
   * it; an existing one (made with Google or an earlier code) a code that signs in. Either way the
   * next step is the code.
   *
   * There are no passwords. Cognito will not create an account without one, so SignUp gets random
   * bytes that are thrown away at once, and the server replaces them again the moment the address is
   * confirmed. Sign-in is always a 6-digit code (our own challenge: Cognito's email code is 8 digits
   * and fixed).
   */
  async startEmail(email: string): Promise<CodeSent> {
    const address = email.trim().toLowerCase();
    if (this.pacing.waitFor(address) > 0) {
      // Back to the same address within the pause: the code already sent still works.
      if (this.pending?.email === address) return this.pacing.status(address);
      throw new Error(this.pacing.tooSoon(address));
    }
    await this.sendCode(address);
    this.pacing.record(address);
    return this.pacing.status(address);
  }

  /** Emails `address` a code and sets up the attempt it belongs to. Unpaced: callers pace it. */
  private async sendCode(address: string): Promise<void> {
    try {
      const reply = await cognito<{ Session?: string }>("SignUp", {
        ClientId: CLIENT_ID,
        Username: address,
        Password: `${randomBytes(24).toString("base64url")}aA1!`,
        UserAttributes: [{ Name: "email", Value: address }],
      });
      this.pending = {
        email: address,
        kind: "new",
        ...(reply.Session ? { session: reply.Session } : {}),
      };
      return;
    } catch (error) {
      // Anything but "already exists" is a real problem with the address (or the network).
      if (!(error instanceof CognitoError && error.type === "UsernameExistsException")) throw error;
    }
    try {
      const reply = await cognito<AuthReply>("InitiateAuth", {
        ClientId: CLIENT_ID,
        AuthFlow: "CUSTOM_AUTH",
        AuthParameters: { USERNAME: address },
      });
      if (reply.ChallengeName !== "CUSTOM_CHALLENGE" || !reply.Session) {
        throw new Error("Couldn't send a code to this email. Try again in a moment.");
      }
      this.pending = { email: address, kind: "existing", session: reply.Session };
    } catch (error) {
      // Created earlier but never confirmed: the code confirms it, as for a new account.
      if (!(error instanceof CognitoError && error.type === "UserNotConfirmedException")) throw error;
      await cognito("ResendConfirmationCode", { ClientId: CLIENT_ID, Username: address });
      this.pending = { email: address, kind: "new" };
    }
  }

  /** The 6-digit code from the email. */
  async verifyEmailCode(code: string): Promise<void> {
    const pending = this.pending;
    if (!pending) throw new Error("That code has expired. Ask for a new email.");
    const entered = code.trim();
    if (!/^\d{6}$/.test(entered)) throw new Error("Enter the 6-digit code from the email.");
    if (pending.kind === "existing") {
      let reply: AuthReply;
      try {
        reply = await cognito<AuthReply>("RespondToAuthChallenge", {
          ClientId: CLIENT_ID,
          ChallengeName: "CUSTOM_CHALLENGE",
          Session: pending.session,
          ChallengeResponses: { USERNAME: pending.email, ANSWER: entered },
        });
      } catch (error) {
        // The third wrong code ends the attempt (or it ran past its 10 minutes).
        if (error instanceof CognitoError && error.type === "NotAuthorizedException") {
          this.pending = null;
          throw new Error("That code didn't work, and this one has now expired. Ask for a new email.");
        }
        throw error;
      }
      if (!reply.AuthenticationResult) {
        // A wrong code with tries left: the same code still works, under the next session.
        if (reply.Session) pending.session = reply.Session;
        throw new Error("That code isn't right. Check the email and try again.");
      }
      await this.adopt(reply, undefined);
    } else {
      const confirmed = await cognito<{ Session?: string }>("ConfirmSignUp", {
        ClientId: CLIENT_ID,
        Username: pending.email,
        ConfirmationCode: entered,
        ...(pending.session ? { Session: pending.session } : {}),
      });
      await this.adopt(await this.signInAfterConfirming(pending, confirmed.Session), undefined);
    }
    this.pending = null;
    this.announce();
  }

  /**
   * Straight in after the code confirmed a new account, with the session ConfirmSignUp returns. An
   * account confirmed from an earlier run of the app has none, and gets one more code, as a sign-in.
   */
  private async signInAfterConfirming(
    pending: NonNullable<Account["pending"]>,
    session: string | undefined,
  ): Promise<AuthReply> {
    if (session) {
      const reply = await cognito<AuthReply>("InitiateAuth", {
        ClientId: CLIENT_ID,
        AuthFlow: "USER_AUTH",
        AuthParameters: { USERNAME: pending.email },
        Session: session,
      }).catch(() => null);
      if (reply?.AuthenticationResult) return reply;
    }
    // The account exists and is confirmed now, so from here on the code is a sign-in code. Said
    // before asking for it: if the server refuses the code for now, Resend takes the sign-in path.
    this.pending = { email: pending.email, kind: "existing" };
    try {
      await this.sendCode(pending.email);
    } catch {
      this.pacing.record(pending.email);
      throw new Error("Your account is ready. In a minute, press Resend code to get your sign-in code.");
    }
    this.pacing.record(pending.email);
    throw new Error("Your account is ready. We sent you one more code to sign in.");
  }

  async resendEmailCode(): Promise<CodeSent> {
    const pending = this.pending;
    if (!pending) throw new Error("Start again with your email.");
    if (this.pacing.waitFor(pending.email) > 0) throw new Error(this.pacing.tooSoon(pending.email));
    if (pending.kind === "new") {
      await cognito("ResendConfirmationCode", { ClientId: CLIENT_ID, Username: pending.email });
    } else {
      // A new attempt: a new code, the old one void.
      await this.sendCode(pending.email);
    }
    this.pacing.record(pending.email);
    return this.pacing.status(pending.email);
  }

  /**
   * Google, in the user's browser; resolves once they are back and signed in. The first Google
   * sign-in for an email links it to that email's account, and Cognito refuses that one attempt
   * ("Already found an entry"); asked again, it signs in to the linked account. Google remembers
   * the choice, so the second round in the browser is a blink.
   */
  async signInWithGoogle({ chooseAccount = false }: { chooseAccount?: boolean } = {}): Promise<void> {
    // With nothing remembered there is nothing to continue with: Google's list either way.
    const remembered = await this.rememberedGoogle();
    const options = {
      domain: SIGN_IN_DOMAIN,
      clientId: CLIENT_ID,
      provider: "Google" as const,
      chooseAccount: chooseAccount || !remembered,
    };
    let tokens: Awaited<ReturnType<typeof signInInBrowser>>;
    try {
      tokens = await signInInBrowser(options);
    } catch (error) {
      if (!(error instanceof LinkedJustNow)) throw error;
      tokens = await signInInBrowser(options);
    }
    await this.adopt({ AuthenticationResult: tokens }, undefined);
    await this.rememberGoogle();
    this.announce();
  }

  /** Deletes the account at Cognito (Google's link goes with it), then signs out here. */
  /**
   * The server deletes the sign-in account itself (DELETE /v1/account); this makes sure, for a
   * server that did not, and finds it already gone otherwise, which is the same result.
   */
  async deleteAccount(): Promise<void> {
    await cognito("DeleteUser", { AccessToken: await this.token() }).catch((error: unknown) => {
      const gone =
        error instanceof CognitoError &&
        (error.type === "NotAuthorizedException" || error.type === "UserNotFoundException");
      if (!gone) throw error;
    });
    const email = this.session?.email;
    this.session = null;
    await this.forget();
    // A deleted account is not offered again.
    if (email && (await this.rememberedGoogle())?.email === email) {
      this.lastGoogle = null;
      await unlink(this.lastGoogleFile).catch(() => {});
    }
    this.announce();
  }

  async signOut(): Promise<void> {
    if (this.session?.google) await this.rememberGoogle().catch(() => {});
    const refreshToken = this.session?.refreshToken;
    this.session = null;
    await this.forget();
    this.announce();
    // Revoking makes the token useless even if a copy survived somewhere; failing to reach Cognito
    // must not keep anyone signed in on this Mac, so it is best effort, after the local sign-out.
    if (refreshToken) {
      await cognito("RevokeToken", { ClientId: CLIENT_ID, Token: refreshToken }).catch(() => {});
    }
  }

  async state(): Promise<AccountState> {
    if (this.devToken) {
      const name = this.devToken.replace(/^dev:/, "");
      return {
        id: `dev-${name}`,
        email: `${name}@dev.local`,
        signedIn: true,
        name,
        onboarded: true,
        suggestedName: "",
        photo: "",
        lastGoogle: null,
      };
    }
    const session = this.session;
    if (!session)
      return {
        id: null,
        email: null,
        signedIn: false,
        name: "",
        onboarded: false,
        suggestedName: "",
        photo: "",
        lastGoogle: await this.rememberedGoogle(),
      };
    return {
      id: session.id || null,
      email: session.email || null,
      signedIn: true,
      name: session.name,
      onboarded: session.name.trim() !== "",
      suggestedName: session.givenName ?? "",
      photo: session.photo ?? "",
      lastGoogle: null,
    };
  }

  /** The name is a standard attribute of the account, so it follows the user to any device. */
  async setProfile(name: string): Promise<void> {
    // The first name ever given is the end of setup: the moment for the welcome email.
    const finishingSetup = !this.session?.name.trim();
    await cognito("UpdateUserAttributes", {
      AccessToken: await this.token(),
      UserAttributes: [{ Name: "name", Value: name }],
    });
    if (this.session) {
      this.session.name = name;
      await this.remember(this.session);
    }
    this.announce();
    if (finishingSetup) void this.askForWelcome();
  }

  /**
   * The welcome email, with the name just given. The server sends it once per account (and only to
   * an address its owner proved), so asking again is harmless; a failure is not the user's problem.
   */
  private async askForWelcome(): Promise<void> {
    if (this.devToken) return;
    try {
      await fetch(`${this.apiUrl}/v1/welcome`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          ...clientHeaders(),
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      // Offline: no welcome. The account works the same.
    }
  }

  /**
   * The access token for our server, renewed when it is close to expiring. "" when nobody is
   * signed in, which the server answers with "sign in".
   */
  async token(): Promise<string> {
    if (this.devToken) return this.devToken;
    const session = this.session;
    if (!session) return "";
    if (Date.now() > session.expiresAt - RENEW_BEFORE_MS) {
      this.renewing ??= this.renew(session.refreshToken)
        .catch(async (error) => {
          // A refresh token Cognito refuses (revoked, expired after 30 days) is a sign-out.
          if (error instanceof CognitoError) {
            this.session = null;
            await this.forget();
            this.announce();
          }
        })
        .finally(() => {
          this.renewing = null;
        });
      await this.renewing;
    }
    return this.session?.accessToken ?? "";
  }

  onChanged(listener: (state: AccountState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async renew(refreshToken: string): Promise<void> {
    // GetTokensFromRefreshToken, not InitiateAuth REFRESH_TOKEN_AUTH: it is the call that hands back
    // a new refresh token once rotation is on for this client (each renewal then extends the sign-in
    // by another 30 days, so only 30 days without opening the app sign the user out). With rotation
    // off it renews exactly like the old call. adopt() saves the new token at once.
    const reply = await cognito<AuthReply>("GetTokensFromRefreshToken", {
      ClientId: CLIENT_ID,
      RefreshToken: refreshToken,
    });
    const before = this.session?.id;
    await this.adopt(reply, refreshToken);
    // Only a change of who is signed in is news; a quiet renewal every hour is not.
    if (this.session?.id !== before) this.announce();
  }

  /** Takes the tokens from a sign-in or a renewal; the id token says who the user is. */
  private async adopt(reply: AuthReply, previousRefresh: string | undefined): Promise<void> {
    const result = reply.AuthenticationResult;
    if (!result) throw new Error("Sign-in needs a step this app does not support yet.");
    const refreshToken = result.RefreshToken ?? previousRefresh;
    if (!refreshToken) throw new Error("Sign-in did not return a session. Try again.");
    const previous = this.session;
    const claims = decodeJwt(result.IdToken);
    this.session = {
      accessToken: result.AccessToken,
      refreshToken,
      expiresAt: Date.now() + result.ExpiresIn * 1000,
      id: String(claims.sub ?? ""),
      email: String(claims.email ?? ""),
      name: typeof claims.name === "string" ? claims.name : "",
      ...(typeof claims.given_name === "string" ? { givenName: claims.given_name } : {}),
      ...(linksGoogle(claims.identities) ? { google: true } : {}),
    };
    // The same person keeps the photo already fetched; a new one gets theirs fetched once.
    if (previous?.id === this.session.id && previous.photo) this.session.photo = previous.photo;
    else if (typeof claims.picture === "string") void this.fetchPhoto(claims.picture);
    await this.remember(this.session);
  }

  /** Google's photo, small, as a data: URL. A failure only means the initial stays. */
  private async fetchPhoto(url: string): Promise<void> {
    try {
      const small = url.replace(/=s\d+(-c)?$/, "=s96-c");
      if (!small.startsWith("https://")) return;
      const response = await fetch(small, { signal: AbortSignal.timeout(8000) });
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !type.startsWith("image/")) return;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 200_000) return;
      if (!this.session) return;
      this.session.photo = `data:${type};base64,${bytes.toString("base64")}`;
      await this.remember(this.session);
      // The photo usually lands after the sign-in: the remembered Google account gets it too.
      if ((await this.rememberedGoogle())?.email === this.session.email) await this.rememberGoogle();
      this.announce();
    } catch {
      // Offline, or Google refused: the round initial is shown instead.
    }
  }

  private announce(): void {
    void this.state().then((state) => {
      for (const listener of this.listeners) listener(state);
    });
  }

  private async remember(session: Session): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) return;
    const saved: Saved = {
      refreshToken: session.refreshToken,
      id: session.id,
      email: session.email,
      name: session.name,
      ...(session.photo ? { photo: session.photo } : {}),
    };
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(this.file, safeStorage.encryptString(JSON.stringify(saved)));
  }

  private async readSaved(): Promise<Saved | null> {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const saved = JSON.parse(safeStorage.decryptString(await readFile(this.file))) as Partial<Saved>;
      if (typeof saved.refreshToken !== "string" || !saved.refreshToken) return null;
      return {
        refreshToken: saved.refreshToken,
        id: String(saved.id ?? ""),
        email: String(saved.email ?? ""),
        name: String(saved.name ?? ""),
        ...(typeof saved.photo === "string" && saved.photo.startsWith("data:image/")
          ? { photo: saved.photo }
          : {}),
      };
    } catch {
      // No session yet, one this machine can no longer decrypt, or a sign-in from before Cognito
      // (a bare token, not JSON): the user is simply asked to sign in again.
      return null;
    }
  }

  private async forget(): Promise<void> {
    await unlink(this.file).catch(() => {});
  }

  /** Encrypted like the session: it names the person, and only this Mac's user should read it. */
  private async rememberGoogle(): Promise<void> {
    const session = this.session;
    if (!session?.email || !safeStorage.isEncryptionAvailable()) return;
    this.lastGoogle = {
      email: session.email,
      name: session.name || session.givenName || "",
      photo: session.photo ?? "",
    };
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(this.lastGoogleFile, safeStorage.encryptString(JSON.stringify(this.lastGoogle)));
  }

  private async rememberedGoogle(): Promise<LastGoogleAccount | null> {
    if (this.lastGoogle !== undefined) return this.lastGoogle;
    this.lastGoogle = null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const saved = JSON.parse(safeStorage.decryptString(await readFile(this.lastGoogleFile))) as Record<
        string,
        unknown
      >;
      if (typeof saved.email === "string" && saved.email) {
        this.lastGoogle = {
          email: saved.email,
          name: typeof saved.name === "string" ? saved.name : "",
          photo: typeof saved.photo === "string" && saved.photo.startsWith("data:image/") ? saved.photo : "",
        };
      }
    } catch {
      // Never signed in with Google here, or a file this Mac can no longer read: nothing offered.
    }
    return this.lastGoogle;
  }
}

/** Cognito's `identities` claim (a list, or that list as JSON text) names the linked providers. */
function linksGoogle(identities: unknown): boolean {
  let list = identities;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return false;
    }
  }
  return Array.isArray(list) && list.some((entry) => entry?.providerName === "Google");
}

interface AuthReply {
  AuthenticationResult?: {
    AccessToken: string;
    IdToken: string;
    RefreshToken?: string;
    ExpiresIn: number;
  };
  ChallengeName?: string;
  Session?: string;
}

/** Cognito said no (wrong password, bad code…), as opposed to the network failing. */
class CognitoError extends Error {
  constructor(
    readonly type: string,
    message: string,
  ) {
    super(message);
  }
}

async function cognito<T = unknown>(operation: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(COGNITO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${operation}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Can't reach the sign-in service. Check your connection.");
  }
  const reply = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // "__type" is "NotAuthorizedException", sometimes with a namespace in front of a "#".
    const type =
      String(reply.__type ?? "")
        .split("#")
        .pop() ?? "";
    throw new CognitoError(type, friendly(type, String(reply.message ?? reply.Message ?? ""), operation));
  }
  return reply as T;
}

/** A sign-in Cognito would not start, for an address it does not explain. */
const NO_START = "Couldn't sign in with that email. Check it, or continue with Google.";

/** Cognito's messages are written for developers; these are the ones people actually hit. */
function friendly(type: string, message: string, operation: string): string {
  switch (type) {
    case "NotAuthorizedException":
      if (/refresh token/i.test(message)) return "Your sign-in has expired. Sign in again.";
      // At sign-in it is the address that was refused; anywhere else (saving a name, say) it is
      // the session.
      if (operation !== "InitiateAuth") {
        console.error(`sign-in: ${operation} refused: ${message}`);
        return "Your sign-in needs refreshing. Sign out and sign in again.";
      }
      return NO_START;
    case "UserNotFoundException":
      return NO_START;
    case "UsernameExistsException":
      return "There is already an account with this email. Sign in instead.";
    case "CodeMismatchException":
      return "That code isn't right. Check the email and try again.";
    case "ExpiredCodeException":
      return "That code has expired. Ask for a new one.";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Too many tries. Wait a few minutes and try again.";
    case "InvalidParameterException":
      return /email/i.test(message) ? "Enter a valid email address." : message || "Check what you entered.";
    case "CodeDeliveryFailureException":
      return "We couldn't send the email. Check the address and try again.";
    case "UserLambdaValidationException":
      // Our server's own limits on codes (subxvoice-api auth-triggers), named by their first word.
      if (/TOO_SOON/.test(message)) return "Wait a minute before asking for another code.";
      if (/TOO_MANY_CODES/.test(message))
        return "That's 3 codes in 10 minutes. Try again in a few minutes, or continue with Google.";
      if (/TOO_MANY_TRIES/.test(message))
        return "Too many wrong codes for this email today. Try again tomorrow, or continue with Google.";
      if (/EMAIL_NOT_NORMALISED/.test(message)) return "Enter the email address in lowercase.";
      console.error(`sign-in: ${type}: ${message}`);
      return "Something went wrong with sign-in. Try again.";
    default:
      // Anything else is Cognito talking to developers: logged, not shown.
      console.error(`sign-in: ${type || "error"}: ${message}`);
      return "Something went wrong with sign-in. Try again.";
  }
}

/** The claims of a JWT, unverified: it came straight from Cognito over TLS, and is only read for display. */
function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
