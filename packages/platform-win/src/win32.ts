// The handful of Win32 calls the Windows plug needs, in one place.
//
// Why FFI and not uiohook-napi (the original plan): a low-level keyboard hook is silently removed
// by Windows when its callback runs slow, and one exception kills the listener thread — either way
// the hotkey dies for the rest of the run with nothing on screen. Reading key state cannot be
// revoked and cannot desync from a key-up we never saw. See docs/decisions.md.
import koffi from "koffi";
import { markOwnInput } from "./own-input";

const KEYBDINPUT = koffi.struct("KEYBDINPUT", {
  wVk: "uint16",
  wScan: "uint16",
  dwFlags: "uint32",
  time: "uint32",
  dwExtraInfo: "uintptr",
});

/** On x64 this must come out as 40 bytes or SendInput rejects the batch. */
const INPUT = koffi.struct("INPUT", {
  type: "uint32",
  ki: KEYBDINPUT,
  _pad: koffi.array("uint8", 8),
});

// The full INPUT, mouse or keyboard, for the assistant's executor (input.ts). Dictation's paste
// keeps the keyboard-only INPUT above, which has been proven in every release.
const MOUSEINPUT = koffi.struct("MOUSEINPUT", {
  dx: "int32",
  dy: "int32",
  mouseData: "int32", // a DWORD, but a wheel's notches are signed
  dwFlags: "uint32",
  time: "uint32",
  dwExtraInfo: "uintptr",
});
const INPUT_ANY = koffi.struct("INPUT_ANY", {
  type: "uint32",
  u: koffi.union("INPUT_UNION", { mi: MOUSEINPUT, ki: KEYBDINPUT }),
});
const POINT = koffi.struct("POINT", { x: "int32", y: "int32" });
const LASTINPUTINFO = koffi.struct("LASTINPUTINFO", { cbSize: "uint32", dwTime: "uint32" });

// The DLLs are loaded on first use, not at import, so importing this package (tests, app start)
// costs nothing until a key is actually watched.
function bind() {
  const lib = koffi.load("user32.dll");
  const kernel = koffi.load("kernel32.dll");
  return {
    getAsyncKeyState: lib.func("__stdcall", "GetAsyncKeyState", "int16", ["int"]),
    sendInput: lib.func("__stdcall", "SendInput", "uint32", ["uint32", koffi.pointer(INPUT), "int"]),
    sendInputAny: lib.func("__stdcall", "SendInput", "uint32", ["uint32", koffi.pointer(INPUT_ANY), "int"]),
    setCursorPos: lib.func("__stdcall", "SetCursorPos", "int", ["int", "int"]),
    getCursorPos: lib.func("__stdcall", "GetCursorPos", "int", [koffi.out(koffi.pointer(POINT))]),
    setThreadDpiAwarenessContext: lib.func("__stdcall", "SetThreadDpiAwarenessContext", "intptr", ["intptr"]),
    mapVirtualKeyW: lib.func("__stdcall", "MapVirtualKeyW", "uint32", ["uint32", "uint32"]),
    getLastInputInfo: lib.func("__stdcall", "GetLastInputInfo", "int", [
      koffi.inout(koffi.pointer(LASTINPUTINFO)),
    ]),
    getTickCount: kernel.func("__stdcall", "GetTickCount", "uint32", []),
    getForegroundWindow: lib.func("__stdcall", "GetForegroundWindow", "void *", []),
    getWindowTextW: lib.func("__stdcall", "GetWindowTextW", "int", [
      "void *",
      koffi.out(koffi.pointer("uint16")),
      "int",
    ]),
    getWindowThreadProcessId: lib.func("__stdcall", "GetWindowThreadProcessId", "uint32", [
      "void *",
      koffi.out(koffi.pointer("uint32")),
    ]),
    openProcess: kernel.func("__stdcall", "OpenProcess", "void *", ["uint32", "int", "uint32"]),
    queryFullProcessImageNameW: kernel.func("__stdcall", "QueryFullProcessImageNameW", "int", [
      "void *",
      "uint32",
      koffi.out(koffi.pointer("uint16")),
      koffi.inout(koffi.pointer("uint32")),
    ]),
    closeHandle: kernel.func("__stdcall", "CloseHandle", "int", ["void *"]),
  };
}

let winmm: ((sound: Buffer, module: null, flags: number) => number) | null = null;
const SND_ASYNC = 0x0001;
const SND_NODEFAULT = 0x0002;
const SND_MEMORY = 0x0004;

/**
 * Plays a WAV held in memory and returns at once (feedback.ts). The buffer must outlive the sound;
 * the cues are module constants, so they always do. winmm.dll loads on the first cue.
 */
export function playWave(wav: Buffer): void {
  winmm ??= koffi.load("winmm.dll").func("__stdcall", "PlaySoundW", "int", ["void *", "void *", "uint32"]);
  winmm(wav, null, SND_MEMORY | SND_ASYNC | SND_NODEFAULT);
}

let user32: ReturnType<typeof bind> | null = null;
const win32 = () => {
  user32 ??= bind();
  return user32;
};

export const VK = {
  control: 0x11,
  shift: 0x10,
  alt: 0x12,
  lwin: 0x5b,
  rwin: 0x5c,
  lctrl: 0xa2,
  rctrl: 0xa3,
  v: 0x56,
} as const;

const KEYEVENTF_KEYUP = 2;
const INPUT_KEYBOARD = 1;

export function isKeyDown(vk: number): boolean {
  return (win32().getAsyncKeyState(vk) & 0x8000) !== 0;
}

const key = (vk: number, up: boolean) => ({
  type: INPUT_KEYBOARD,
  ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0n },
  _pad: Array(8).fill(0),
});

/** Presses and releases `vk` while holding `modifiers`. Returns false if Windows dropped any event. */
export function sendChord(modifiers: number[], vk: number): boolean {
  const events = [
    ...modifiers.map((mod) => key(mod, false)),
    key(vk, false),
    key(vk, true),
    ...[...modifiers].reverse().map((mod) => key(mod, true)),
  ];
  markOwnInput();
  return win32().sendInput(events.length, events, koffi.sizeof(INPUT)) === events.length;
}

/** One event for `sendInputs`: a key (by virtual key, or a UTF-16 unit with KEYEVENTF_UNICODE) or a mouse button/wheel. */
export type InputEvent =
  | { kind: "key"; vk: number; scan: number; flags: number }
  | { kind: "mouse"; flags: number; data: number };

/** Sends the events in one batch, so nothing the user does can land between them. */
export function sendInputs(events: InputEvent[]): number {
  const batch = events.map((e) =>
    e.kind === "key"
      ? {
          type: INPUT_KEYBOARD,
          u: { ki: { wVk: e.vk, wScan: e.scan, dwFlags: e.flags, time: 0, dwExtraInfo: 0n } },
        }
      : {
          type: 0,
          u: { mi: { dx: 0, dy: 0, mouseData: e.data, dwFlags: e.flags, time: 0, dwExtraInfo: 0n } },
        },
  );
  markOwnInput();
  return win32().sendInputAny(batch.length, batch, koffi.sizeof(INPUT_ANY));
}

/**
 * Runs `fn` with this thread per-monitor DPI aware (V2), then restores it. Without it, Node and an
 * unaware thread see a 150% display's coordinates scaled, and every cursor position is off.
 */
export function perMonitorDpi<T>(fn: () => T): T {
  const previous = win32().setThreadDpiAwarenessContext(-4);
  try {
    return fn();
  } finally {
    if (previous) win32().setThreadDpiAwarenessContext(previous);
  }
}

/** Physical pixels on the virtual desktop. */
export function setCursorPos(x: number, y: number): void {
  if (!perMonitorDpi(() => win32().setCursorPos(x, y)))
    throw new Error(`Could not move the mouse to ${x}, ${y}`);
}

export function getCursorPos(): [number, number] {
  const point = { x: 0, y: 0 };
  perMonitorDpi(() => win32().getCursorPos(point));
  return [point.x, point.y];
}

/**
 * Date.now() of the last mouse or keyboard input Windows saw, from anyone (injected input too).
 * Windows counts in ms since boot in 32 bits; the subtraction wraps the same way after 49 days.
 */
export function lastInputAt(): number {
  const info = { cbSize: koffi.sizeof(LASTINPUTINFO), dwTime: 0 };
  if (!win32().getLastInputInfo(info)) return 0;
  // Same input, same answer: GetTickCount moves in ~16 ms steps and Date.now() in 1 ms, so the
  // converted time jitters and touch.ts saw "new" input where there was none (T9–T13 review).
  if (info.dwTime === lastInput.dwTime) return lastInput.at;
  const ago = (win32().getTickCount() - info.dwTime) >>> 0;
  lastInput = { dwTime: info.dwTime, at: Date.now() - ago };
  return lastInput.at;
}
let lastInput = { dwTime: -1, at: 0 };

/** The hardware scan code of a virtual key; games and emulators read it instead of the virtual key. */
export function scanCodeOf(vk: number): number {
  return win32().mapVirtualKeyW(vk, 0); // MAPVK_VK_TO_VSC
}

/** Windows writes strings as UTF-16; koffi hands them back as raw code units. */
const decodeWide = (buffer: Uint16Array, length: number) =>
  Buffer.from(buffer.buffer, buffer.byteOffset, length * 2).toString("utf16le");

/** Enough for any window title; longer ones are simply cut off. */
const TITLE_CHARS = 512;
const PATH_CHARS = 1024;

/** Lets us read another process's image name without the right to read its memory. */
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

/**
 * The window the user was typing in, read at key-down. Returns null when there is no foreground
 * window (the desktop is focused, or a secure-attention screen is up).
 */
/** The front window as a number, to notice a switch; 0 when there is none. */
export function foregroundHandle(): number {
  const handle = win32().getForegroundWindow();
  return handle ? Number(koffi.address(handle)) : 0;
}

/** Every mouse button and key down right now (virtual-key codes 0x01–0xFE). */
export function pressedKeys(): Set<number> {
  const down = new Set<number>();
  for (let vk = 0x01; vk <= 0xfe; vk++) if (isKeyDown(vk)) down.add(vk);
  return down;
}

export function foregroundWindow(): { title: string; exePath: string } | null {
  const { getForegroundWindow, getWindowTextW, getWindowThreadProcessId } = win32();
  const handle = getForegroundWindow();
  if (!handle) return null;

  const titleBuffer = new Uint16Array(TITLE_CHARS);
  const titleLength = getWindowTextW(handle, titleBuffer, TITLE_CHARS);
  const title = titleLength > 0 ? decodeWide(titleBuffer, titleLength) : "";

  const pidOut = new Uint32Array(1);
  getWindowThreadProcessId(handle, pidOut);
  const pid = pidOut[0];
  if (!pid) return { title, exePath: "" };

  return { title, exePath: processImagePath(pid) };
}

/** "" when the process is gone or more privileged than ours, which is not worth reporting. */
function processImagePath(pid: number): string {
  const { openProcess, queryFullProcessImageNameW, closeHandle } = win32();
  const process = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!process) return "";
  try {
    const pathBuffer = new Uint16Array(PATH_CHARS);
    const size = new Uint32Array([PATH_CHARS]);
    if (!queryFullProcessImageNameW(process, 0, pathBuffer, size)) return "";
    return decodeWide(pathBuffer, size[0] ?? 0);
  } finally {
    closeHandle(process);
  }
}

const MODIFIERS = [VK.control, VK.shift, VK.alt, VK.lwin, VK.rwin];

/**
 * Waits until no modifier is physically held. Pasting while the Windows key is still down would
 * turn our Ctrl+V into Win+V and open clipboard history instead.
 */
export async function waitForModifiersUp(timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!MODIFIERS.some(isKeyDown)) return true;
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  return false;
}
