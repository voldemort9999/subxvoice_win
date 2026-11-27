import { afterEach, describe, expect, it } from "vitest";
import { SubxDictateStt } from "./subx";

/** Stands in for the global WebSocket so the protocol can be driven without a network. */
class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly sent: (Uint8Array | string)[] = [];

  constructor(
    readonly url: string,
    readonly init: { headers: Record<string, string> },
  ) {
    FakeSocket.last = this;
  }
  send(payload: Uint8Array | string): void {
    this.sent.push(payload);
  }
  closed = false;
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  controls(): unknown[] {
    return this.sent.filter((p): p is string => typeof p === "string").map((p) => JSON.parse(p));
  }
  frames(): Uint8Array[] {
    return this.sent.filter((p): p is Uint8Array => typeof p !== "string");
  }
}

const realWebSocket = globalThis.WebSocket;
afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket = realWebSocket;
  FakeSocket.last = null;
});

async function start(app?: string, onPartial?: (text: string) => void) {
  (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
  const stt = new SubxDictateStt({
    baseUrl: "http://127.0.0.1:8080/",
    token: () => "dev:aryan",
    client: "mac/0.0.1",
  });
  const stream = await stt.startStream({
    vocabulary: [],
    ...(app ? { app } : {}),
    ...(onPartial ? { onPartial } : {}),
  });
  return { stream, socket: FakeSocket.last as FakeSocket };
}

describe("SUBXVoice /v1/dictate plug", () => {
  it("connects with the user's session, holds early audio, and says which app", async () => {
    const { stream, socket } = await start("WhatsApp");
    expect(socket.url).toBe("ws://127.0.0.1:8080/v1/dictate");
    expect(socket.init.headers).toEqual({
      Authorization: "Bearer dev:aryan",
      "x-subx-client": "mac/0.0.1",
      // Where the person is: their week (when free words come back) follows it.
      "x-subx-tz": Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    stream.push(new Int16Array([1, 2, 3]));
    expect(socket.sent).toHaveLength(0);
    socket.open();
    expect(socket.controls()[0]).toEqual({ type: "start", sampleRate: 16000, app: "WhatsApp" });
    expect(socket.frames()[0]?.byteLength).toBe(6);
  });

  it("finishes with the server's text and what it heard", async () => {
    const { stream, socket } = await start();
    socket.open();
    socket.deliver({ type: "partial", text: "kal milte" });
    expect(stream.partial()).toBe("kal milte");
    const done = stream.finish();
    expect(socket.controls().at(-1)).toEqual({ type: "finalize" });
    socket.deliver({ type: "final", text: "kal milte hain", raw: "कल मिलते हैं।", timings: {} });
    expect(await done).toEqual({ text: "kal milte hain", raw: "कल मिलते हैं।", languages: [] });
  });

  it("asks for the account's totals only when someone listens, and hands them over after the text", async () => {
    (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
    const seen: unknown[] = [];
    const stt = new SubxDictateStt({
      baseUrl: "http://127.0.0.1:8080/",
      token: () => "dev:aryan",
      client: "mac/0.0.6",
      device: "id=3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b; chip=Apple M2; os=26.1",
      onUsage: (totals) => {
        seen.push(totals);
        throw new Error("a broken listener must not break the dictation");
      },
    });
    const stream = await stt.startStream({ vocabulary: [] });
    const socket = FakeSocket.last as FakeSocket;
    expect(socket.init.headers).toMatchObject({ "x-subx-device": expect.stringContaining("chip=Apple M2") });
    socket.open();
    expect(socket.controls()[0]).toMatchObject({ type: "start", usage: true });
    const done = stream.finish();
    socket.deliver({ type: "final", text: "hello", raw: "hello", timings: {} });
    socket.deliver({ type: "usage", today: { words: 1 } });
    expect(await done).toMatchObject({ text: "hello" });
    expect(seen).toEqual([{ type: "usage", today: { words: 1 } }]);

    // Without a listener nothing is asked: the server sends what it always did.
    const plain = await start();
    plain.socket.open();
    expect(plain.socket.controls()[0]).not.toHaveProperty("usage");
  });

  it("sends finalize once the socket opens if the key came up first", async () => {
    const { stream, socket } = await start();
    const done = stream.finish();
    socket.open();
    expect(socket.controls()).toEqual([{ type: "start", sampleRate: 16000 }, { type: "finalize" }]);
    socket.deliver({ type: "final", text: "", raw: "" });
    expect((await done).text).toBe("");
  });

  it("says what the server's refusal means, in the app's words", async () => {
    const { stream, socket } = await start();
    socket.open();
    socket.deliver({
      type: "error",
      code: "daily_limit",
      message: "You've used this week's free words. They come back on Monday.",
    });
    await expect(stream.finish()).rejects.toThrow(
      "You've used this week's free words. They come back on Monday.",
    );
  });

  it("says the service is busy, in plain words, when it is full", async () => {
    const { stream, socket } = await start();
    socket.open();
    socket.deliver({ type: "error", code: "busy", message: "anything" });
    await expect(stream.finish()).rejects.toThrow(
      "Many people are dictating right now. Try again in a moment.",
    );
  });

  // The server's security audit, 2026-11-20: two open dictations per account, capped message size.
  it("says what the server's new limits mean, in the app's words", async () => {
    const busy = await start();
    busy.socket.open();
    busy.socket.deliver({ type: "error", code: "rate_limited", message: "two open" });
    await expect(busy.stream.finish()).rejects.toThrow(
      "Another dictation on your account is still running. Try again in a moment.",
    );
    const big = await start();
    big.socket.open();
    big.socket.deliver({ type: "error", code: "too_large", message: "256 KB" });
    await expect(big.stream.finish()).rejects.toThrow(
      "That dictation was too long to send. Try a shorter one.",
    );
  });

  it("never shows an engine's own error text", async () => {
    const { stream, socket } = await start();
    socket.open();
    socket.deliver({
      type: "error",
      code: "upstream_unavailable",
      message: "Speech-to-text failed: 503 from upstream",
    });
    const failure = await stream.finish().catch((error: Error) => error.message);
    expect(failure).toBe("SUBXVoice couldn't finish that dictation. Try again in a moment.");
  });

  it("passes on why the words were pasted as heard", async () => {
    const { stream, socket } = await start();
    socket.open();
    const done = stream.finish();
    socket.deliver({ type: "final", text: "Hello.", raw: "Hello.", rewriteError: "rewrite 500" });
    expect(await done).toMatchObject({ text: "Hello.", rewriteError: "rewrite 500" });
  });

  it("passes each partial on as it arrives, for the pill", async () => {
    const heard: string[] = [];
    const { socket } = await start(undefined, (text) => heard.push(text));
    socket.open();
    socket.deliver({ type: "partial", text: "kal" });
    socket.deliver({ type: "partial", text: "kal milte" });
    expect(heard).toEqual(["kal", "kal milte"]);
  });

  it("cancels by closing without finalize, so the server types nothing", async () => {
    const { stream, socket } = await start();
    socket.open();
    stream.cancel?.();
    expect(socket.closed).toBe(true);
    expect(socket.controls()).not.toContainEqual({ type: "finalize" });
  });

  it("sends the dictionary with the start, so the server can hear and spell the user's names", async () => {
    (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
    const stt = new SubxDictateStt({ baseUrl: "http://127.0.0.1:8080", token: () => "dev:aryan" });
    await stt.startStream({
      vocabulary: ["Aarnav", "SUBXVoice"],
      hints: [
        { word: "Aarnav", heard: ["Arnav"] },
        { word: "SUBXVoice", heard: [] },
      ],
    });
    const socket = FakeSocket.last as FakeSocket;
    socket.open();
    expect(socket.controls()[0]).toEqual({
      type: "start",
      sampleRate: 16000,
      terms: [
        { word: "Aarnav", heard: ["Arnav"] },
        { word: "SUBXVoice", heard: [] },
      ],
    });
  });

  it("sends the device's settings with the start, and none when it has none", async () => {
    (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
    const settings = { languages: { spoken: ["hi"], hinglish: false, writeIn: null } };
    await new SubxDictateStt({ baseUrl: "http://x", token: () => "t", settings: () => settings }).startStream(
      {
        vocabulary: [],
      },
    );
    (FakeSocket.last as FakeSocket).open();
    expect((FakeSocket.last as FakeSocket).controls()[0]).toEqual({
      type: "start",
      sampleRate: 16000,
      settings,
    });
    await new SubxDictateStt({ baseUrl: "http://x", token: () => "t", settings: () => null }).startStream({
      vocabulary: [],
    });
    (FakeSocket.last as FakeSocket).open();
    expect((FakeSocket.last as FakeSocket).controls()[0]).toEqual({ type: "start", sampleRate: 16000 });
  });

  it("waits for the screen's text and sends it with the start, cut to what the server takes", async () => {
    (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
    let read!: (text: string) => void;
    const screen = new Promise<string | null>((resolve) => {
      read = resolve;
    });
    await new SubxDictateStt({ baseUrl: "http://x", token: () => "t" }).startStream({
      vocabulary: [],
      screen,
    });
    const socket = FakeSocket.last as FakeSocket;
    socket.open();
    expect(socket.controls()).toEqual([]);
    read(`Chat with Aarnav
${"x".repeat(5000)}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const start = socket.controls()[0] as { screen: string };
    expect(start.screen.startsWith("Chat with Aarnav")).toBe(true);
    expect(start.screen.length).toBe(4000);
  });
});
