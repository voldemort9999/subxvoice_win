import {
  type AudioClip,
  type SttOptions,
  type SttProvider,
  type SttStream,
  SubxError,
  type Transcript,
} from "@subx/core";

/** How a request proves who it is. Read for every dictation, because the session expires. */
export type TokenSource = string | (() => string | Promise<string>);

const resolveToken = async (token: TokenSource): Promise<string> =>
  typeof token === "function" ? await token() : token;

/**
 * Our backend's `/v1/dictate` (subxvoice-api): one socket for the whole dictation. Audio goes in
 * from key-down; at key-up the server returns text that is already finished — heard by Soniox and
 * rewritten from the user's settings while they were still speaking — so the app pastes it as it is.
 * The app holds no vendor key and no prompt; both live on the server.
 */
export interface SubxOptions {
  /** The API's base address, e.g. https://api.subxvoice.com or http://127.0.0.1:8080. */
  baseUrl: string;
  /** The user's session, read fresh for every dictation. */
  token: TokenSource;
  /** `x-subx-client`, e.g. "mac/0.0.1", so the server can serve per-platform engines. */
  client?: string;
  /**
   * The user's dictation settings as this device keeps them, sent with each dictation so the server
   * never reads its database on the way to the first word. Null: the server reads its stored copy.
   */
  settings?: () => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
}

/**
 * What the pill says for each of the server's error codes (docs/API.md there). The server's own
 * message is not shown: for an engine failure it carries the engine's words, meant for us.
 */
const SERVER_PROBLEMS: Record<string, string> = {
  unauthorized: "Sign in to SUBXVoice again to dictate.",
  daily_limit: "You've used today's dictation time. It resets tomorrow.",
  shutting_down: "SUBXVoice is restarting. Try again in a few seconds.",
  // The server's security audit (2026-11-20): two open dictations per account, capped message size.
  rate_limited: "Another dictation on your account is still running. Try again in a moment.",
  too_large: "That dictation was too long to send. Try a shorter one.",
};
const SERVER_PROBLEM = "SUBXVoice couldn't finish that dictation. Try again in a moment.";

/** The server finishes in ~0.05–0.5 s after release; past this the dictation is failed honestly. */
const FINAL_TIMEOUT_MS = 10_000;

export class SubxDictateStt implements SttProvider {
  readonly id = "subx";
  readonly capabilities = { streaming: true, codeSwitching: true, vocabularyHints: true };

  constructor(private readonly options: SubxOptions) {}

  async transcribe(audio: AudioClip, options: SttOptions): Promise<Transcript> {
    const stream = await this.startStream(options, audio.sampleRate);
    stream.push(audio.samples);
    return stream.finish();
  }

  /** Returns at once: audio pushed before the socket opens is held and sent on open, never dropped. */
  async startStream(options: SttOptions, sampleRate = 16000): Promise<SttStream> {
    const token = await resolveToken(this.options.token);
    if (!token) throw new SubxError("permission_denied", "Sign in to SUBXVoice to dictate.");
    // A local file read; a failure only means the server uses its own copy.
    const settings = (await Promise.resolve(this.options.settings?.()).catch(() => null)) ?? null;
    return new SubxStream(this.options, token, options, sampleRate, settings);
  }
}

interface FinalMessage {
  type: "final";
  text: string;
  raw?: string;
  rewriteError?: string;
}

class SubxStream implements SttStream {
  private readonly socket: WebSocket;
  private backlog: Uint8Array[] = [];
  private opened = false;
  private released = false;
  private latest = "";
  private failure: Error | null = null;
  private result: FinalMessage | null = null;
  private settle: (() => void) | null = null;
  private readonly onPartial: ((text: string) => void) | undefined;

  constructor(
    options: SubxOptions,
    token: string,
    stt: SttOptions,
    sampleRate: number,
    settings: Record<string, unknown> | null,
  ) {
    this.onPartial = stt.onPartial;
    // Node's and Electron's WebSocket (undici) takes headers; the DOM type does not describe it.
    const WithHeaders = WebSocket as unknown as new (
      url: string,
      init: { headers: Record<string, string> },
    ) => WebSocket;
    const url = `${options.baseUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/v1/dictate`;
    this.socket = new WithHeaders(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.client ? { "x-subx-client": options.client } : {}),
      },
    });
    this.socket.binaryType = "arraybuffer";

    this.socket.onopen = () => {
      this.opened = true;
      // The dictionary lives on this Mac; sent with every dictation, it is what the recogniser and
      // the rewrite spell names from. Without it the user's words never left the app.
      this.socket.send(
        JSON.stringify({
          type: "start",
          sampleRate,
          ...(stt.app ? { app: stt.app } : {}),
          // Each word with the spellings it has come out as, so the rewrite can recognise them.
          ...(stt.vocabulary.length > 0
            ? { terms: (stt.hints ?? stt.vocabulary.map((word) => ({ word, heard: [] }))).slice(0, 300) }
            : {}),
          ...(settings ? { settings } : {}),
        }),
      );
      for (const frame of this.backlog) this.socket.send(frame);
      this.backlog = [];
      if (this.released) this.socket.send(JSON.stringify({ type: "finalize" }));
    };
    this.socket.onmessage = (event) => this.receive(event.data);
    this.socket.onerror = () =>
      this.fail(new SubxError("provider", "Can't reach SUBXVoice. Check your internet connection."));
    this.socket.onclose = () => {
      if (!this.result && !this.failure) {
        this.fail(new SubxError("provider", "Lost the connection to SUBXVoice. Try again."));
      }
    };
  }

  push(samples: Int16Array): void {
    if (this.released || this.failure) return;
    const frame = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength).slice();
    if (this.opened) this.socket.send(frame);
    else this.backlog.push(frame);
  }

  partial(): string {
    return this.latest;
  }

  /** Closing without "finalize" is how the server knows to drop it: nothing is rewritten or sent. */
  cancel(): void {
    this.released = true;
    this.fail(new SubxError("provider", "Cancelled."));
    this.socket.close();
  }

  async finish(): Promise<Transcript> {
    this.released = true;
    if (this.opened && !this.result && !this.failure) this.socket.send(JSON.stringify({ type: "finalize" }));
    if (!this.result && !this.failure) {
      await new Promise<void>((resolve) => {
        this.settle = resolve;
        setTimeout(
          () => this.fail(new SubxError("provider", "SUBXVoice took too long to finish. Try again.")),
          FINAL_TIMEOUT_MS,
        );
      });
    }
    if (this.result) {
      return {
        text: this.result.text,
        languages: [],
        ...(this.result.raw !== undefined ? { raw: this.result.raw } : {}),
        ...(this.result.rewriteError ? { rewriteError: this.result.rewriteError } : {}),
      };
    }
    throw this.failure ?? new SubxError("provider", "That dictation didn't go through. Try again.");
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    let message: {
      type?: string;
      text?: string;
      raw?: string;
      rewriteError?: string;
      message?: string;
      code?: string;
    };
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === "partial") {
      this.latest = message.text ?? "";
      this.onPartial?.(this.latest);
    } else if (message.type === "final") {
      this.result = {
        type: "final",
        text: message.text ?? "",
        raw: message.raw,
        rewriteError: message.rewriteError,
      };
      this.settle?.();
    } else if (message.type === "error") {
      const code = message.code === "unauthorized" ? "permission_denied" : "provider";
      this.fail(new SubxError(code, SERVER_PROBLEMS[message.code ?? ""] ?? SERVER_PROBLEM));
    }
  }

  private fail(error: Error): void {
    if (this.result || this.failure) return;
    this.failure = error;
    this.settle?.();
  }
}
