import type { HotkeyEvent } from "@subx/core";
import { describe, expect, it } from "vitest";
import { anyOtherKeyDown, bindingFor, parseBinding, WinHotkey } from "./hotkey";
import { VK } from "./win32";

const D = 0x44; // the "D" key, as in Ctrl+Win+D

/** A fake keyboard: a WinHotkey plus the set of keys currently held. */
function keyboard(keys = "ctrl+win") {
  const held = new Set<number>();
  const events: HotkeyEvent[] = [];
  const hotkey = new WinHotkey((vk) => held.has(vk));
  void hotkey.register([{ keys, mode: "exact" }], () => {});
  const tick = () => hotkey.tick((event) => events.push(event));
  return { held, events, tick, hotkey };
}

describe("parseBinding", () => {
  it("accepts either side of the Windows key", () => {
    expect(parseBinding("ctrl+win")).toEqual([[VK.control], [VK.lwin, VK.rwin]]);
  });

  it("rejects a key the poller cannot read", () => {
    // Media and browser keys have virtual codes but no name here, so they cannot be bound.
    expect(() => parseBinding("ctrl+volumeup")).toThrow(/Unsupported hotkey/);
  });
});

describe("WinHotkey", () => {
  it("fires once on press and once on release", () => {
    const { held, events, tick } = keyboard();
    held.add(VK.control).add(VK.lwin);
    tick();
    tick(); // still held — must not fire again
    held.delete(VK.lwin);
    tick();
    expect(events).toEqual([
      { type: "pressed", mode: "exact" },
      { type: "released", mode: "exact" },
    ]);
  });

  it("accepts the right Windows key too", () => {
    const { held, events, tick } = keyboard();
    held.add(VK.control).add(VK.rwin);
    tick();
    held.clear();
    tick();
    expect(events.map((event) => event.type)).toEqual(["pressed", "released"]);
  });

  it("half the combo does nothing", () => {
    const { held, events, tick } = keyboard();
    held.add(VK.control);
    tick();
    held.add(D);
    tick();
    expect(events).toEqual([]);
  });

  it("another key pressed while holding does not stop the dictation; the release still ends it", () => {
    // Only Esc stops a dictation (the Mac app's rule since efe7c90; the user chose it for Windows,
    // 2026-11-25): a stray key mid-sentence used to throw the whole dictation away.
    const { held, events, tick } = keyboard();
    held.add(VK.control).add(VK.lwin);
    tick();
    held.add(D);
    tick();
    tick();
    held.clear();
    tick();
    expect(events).toEqual([
      { type: "pressed", mode: "exact" },
      { type: "released", mode: "exact" },
    ]);
  });

  it("Esc stops a dictation that is being watched", () => {
    const { held, events, tick, hotkey } = keyboard();
    held.add(VK.control).add(VK.lwin);
    tick();
    hotkey.watchEscape(true);
    held.add(0x1b);
    tick();
    expect(events).toContainEqual({ type: "cancel", key: 0x1b });
  });

  it("a key already down before the chord (a stuck media key) does not cancel it", () => {
    // Seen on the dev PC 2026-11-18: Windows reported Play/Pause (0xB3) held with nothing pressed,
    // and every hotkey press was cancelled the moment it began.
    const PLAY_PAUSE = 0xb3;
    const { held, events, tick } = keyboard();
    held.add(PLAY_PAUSE);
    tick();
    held.add(VK.control).add(VK.lwin);
    tick();
    tick();
    held.delete(VK.control);
    held.delete(VK.lwin);
    tick();
    expect(events).toEqual([
      { type: "pressed", mode: "exact" },
      { type: "released", mode: "exact" },
    ]);
  });

  it("the binding's own Ctrl never counts as another key", () => {
    const { held, events, tick } = keyboard();
    // Windows reports a real Ctrl press through both the generic and the left-side code.
    held.add(VK.control).add(VK.lctrl).add(VK.lwin);
    tick();
    tick();
    held.clear();
    tick();
    expect(events.map((event) => event.type)).toEqual(["pressed", "released"]);
  });

  // The reason this is polled rather than hooked: a key-up we never saw must not wedge it.
  it("recovers when a release is missed entirely", () => {
    const { held, events, tick } = keyboard();
    held.add(VK.control).add(VK.lwin);
    tick();
    held.clear(); // release goes unobserved
    held.add(VK.control).add(VK.lwin);
    tick();
    held.clear();
    tick();
    held.add(VK.control).add(VK.lwin);
    tick();
    expect(events.map((event) => event.type)).toEqual(["pressed", "released", "pressed"]);
  });
});

describe("anyOtherKeyDown", () => {
  it("ignores the binding's keys and their side-specific twins", () => {
    const own = new Set([VK.control, VK.lwin, VK.rwin]);
    expect(anyOtherKeyDown(own, (vk) => vk === VK.lctrl)).toBe(false);
    expect(anyOtherKeyDown(own, (vk) => vk === D)).toBe(true);
  });

  it("a mouse button is not a key", () => {
    expect(anyOtherKeyDown(new Set([VK.control]), (vk) => vk === 0x01)).toBe(false);
  });
});

describe("accepting a custom combination", () => {
  const hotkey = new WinHotkey(() => false);

  it("takes any combination it can map to real keys", () => {
    expect(hotkey.accepts("ctrl+win")).toBe(true);
    expect(hotkey.accepts("ctrl+shift+f9")).toBe(true);
    expect(hotkey.accepts("alt+k")).toBe(true);
    expect(hotkey.accepts("ctrl+alt+pagedown")).toBe(true);
  });

  it("refuses a single key that typing presses", () => {
    expect(hotkey.accepts("ctrl")).toBe(false);
    expect(hotkey.accepts("k")).toBe(false);
    expect(hotkey.accepts("space")).toBe(false);
    expect(hotkey.accepts("enter")).toBe(false);
  });

  // User, 2026-11-20: "single keys bhi rakhi jaa sake … func key ko bhi set kar saku".
  it("takes a single key that typing never presses: F1–F24, Pause, Scroll Lock", () => {
    expect(hotkey.accepts("f9")).toBe(true);
    expect(hotkey.accepts("f24")).toBe(true);
    expect(hotkey.accepts("pause")).toBe(true);
    expect(hotkey.accepts("scrolllock")).toBe(true);
    expect(parseBinding("pause")).toEqual([[0x13]]);
    expect(parseBinding("scrolllock")).toEqual([[0x91]]);
  });

  it("dictates on a single F-key held and let go", () => {
    const { held, tick, events } = keyboard("f9");
    held.add(0x78);
    tick();
    held.delete(0x78);
    tick();
    expect(events).toEqual([
      { type: "pressed", mode: "exact" },
      { type: "released", mode: "exact" },
    ]);
  });

  it("refuses what it cannot watch, including junk from a hand-edited settings file", () => {
    expect(hotkey.accepts("ctrl+banana")).toBe(false);
    expect(hotkey.accepts("")).toBe(false);
    expect(hotkey.accepts("+++")).toBe(false);
  });

  it("maps letters, digits and function keys to their virtual keys", () => {
    expect(parseBinding("ctrl+k")).toEqual([[0x11], [0x4b]]);
    expect(parseBinding("alt+7")).toEqual([[0x12], [0x37]]);
    expect(parseBinding("shift+f12")).toEqual([[0x10], [0x7b]]);
  });
});

describe("WinHotkey.watchEscape (the Mac app's Esc to cancel, Mac UI port 2026-11-19)", () => {
  const ESC = 0x1b;

  it("reports one cancel per Esc press while watching, with no chord held (hands-free)", () => {
    const { held, events, tick, hotkey } = keyboard();
    hotkey.watchEscape(true);
    held.add(ESC);
    tick();
    tick(); // still down: no repeat
    held.delete(ESC);
    tick();
    held.add(ESC);
    tick();
    expect(events).toEqual([
      { type: "cancel", key: ESC },
      { type: "cancel", key: ESC },
    ]);
  });

  it("ignores Esc when no dictation is open", () => {
    const { held, events, tick, hotkey } = keyboard();
    hotkey.watchEscape(false);
    held.add(ESC);
    tick();
    expect(events).toEqual([]);
  });

  it("does not take an Esc already down when watching starts", () => {
    const { held, events, tick, hotkey } = keyboard();
    held.add(ESC);
    hotkey.watchEscape(true);
    tick();
    expect(events).toEqual([]);
  });
});

// User, 2026-11-20: "hotkey change karne wala system … kuch gini chuni keys set ho pati hai, ek bar
// hatne k baad ctrl + win bhi set nahi hoti". Settings recorded through DOM key events, which named
// the Windows key "cmd" (refused here) and had no name for most keys. The keys are now read by the
// same poll that watches them, so what is recorded is what will be watched.
describe("naming what was held, as the watcher will watch it", () => {
  const LSHIFT = 0xa0;
  const LALT = 0xa4;
  const RALT = 0xa5;

  it("names a modifier chord by its generic keys, whichever side was pressed", () => {
    expect(bindingFor([VK.control, VK.lctrl, VK.lwin])).toBe("ctrl+win");
    expect(bindingFor([VK.control, VK.rctrl, VK.alt, LALT])).toBe("ctrl+alt");
    expect(bindingFor([VK.shift, LSHIFT, 0x41])).toBe("shift+a");
  });

  it("names punctuation, numpad and other keys that had no name before", () => {
    expect(bindingFor([VK.control, VK.lctrl, 0xba])).toBe("ctrl+semicolon");
    expect(bindingFor([VK.alt, LALT, 0x67])).toBe("alt+numpad7");
    expect(bindingFor([VK.control, VK.lctrl, 0x5d])).toBe("ctrl+menu");
  });

  it("keeps the side of a modifier pressed on its own: Right Ctrl, Right Alt, and AltGr as Right Alt", () => {
    expect(bindingFor([VK.control, VK.rctrl])).toBe("rctrl");
    expect(bindingFor([VK.alt, RALT])).toBe("ralt");
    expect(bindingFor([VK.control, VK.lctrl, VK.alt, RALT])).toBe("ralt"); // AltGr
    expect(bindingFor([VK.control, VK.lctrl])).toBe("lctrl");
  });

  it("orders the keys the same way however they were pressed", () => {
    expect(bindingFor([0x78, VK.shift, LSHIFT, VK.control, VK.lctrl])).toBe("ctrl+shift+f9");
  });

  // User, 2026-11-20: "fn key ho hi nahi rahi". Most laptops keep Fn inside the keyboard, but some
  // send a code with no name (0xFF and vendor codes): such a key is recorded by its number.
  it("records a key with no name by its code, so a laptop key that sends anything can be bound", () => {
    expect(bindingFor([0xff])).toBe("vk255");
    expect(bindingFor([VK.control, VK.lctrl, 0xff])).toBe("ctrl+vk255");
    expect(parseBinding("vk255")).toEqual([[0xff]]);
    expect(new WinHotkey(() => false).accepts("vk255")).toBe(true);
    // A named key written as a number is still that key: "a" alone stays refused.
    expect(new WinHotkey(() => false).accepts("vk65")).toBe(false);
  });

  it("leaves out codes no hand can bind (media, IME, typed characters, mouse)", () => {
    expect(bindingFor([0xb3])).toBeNull();
    expect(bindingFor([VK.control, VK.lctrl, VK.lwin, 0xe7, 0x01])).toBe("ctrl+win");
  });
});

describe("recording a hotkey from the keys held", () => {
  function recorder(stuck: number[] = []) {
    const held = new Set<number>(stuck);
    const hotkey = new WinHotkey((vk) => held.has(vk));
    const seen: string[] = [];
    let result: string | null | undefined;
    const recording = hotkey.record((keys) => seen.push(keys));
    void recording.done.then((keys) => {
      result = keys;
    });
    const step = async () => {
      recording.tick();
      await Promise.resolve();
    };
    return { held, seen, step, recording, result: () => result };
  }

  it("records Ctrl + Win: the whole chord at its fullest, saved when every key is let go", async () => {
    const r = recorder();
    r.held.add(VK.control).add(VK.lctrl);
    await r.step();
    r.held.add(VK.lwin);
    await r.step();
    r.held.delete(VK.lwin);
    await r.step();
    expect(r.result()).toBeUndefined(); // Ctrl still down
    r.held.clear();
    await r.step();
    expect(r.seen).toEqual(["lctrl", "ctrl+win"]);
    expect(r.result()).toBe("ctrl+win");
  });

  it("records a single F-key", async () => {
    const r = recorder();
    r.held.add(0x78);
    await r.step();
    r.held.clear();
    await r.step();
    expect(r.result()).toBe("f9");
  });

  it("ignores what was already down when recording began — the click on Change, a stuck media key", async () => {
    const r = recorder([0x01, 0xb3]);
    r.held.add(0x78);
    await r.step();
    r.held.delete(0x78);
    await r.step();
    expect(r.result()).toBe("f9");
  });

  it("stops on Esc pressed alone, and on cancel", async () => {
    const esc = recorder();
    esc.held.add(0x1b);
    await esc.step();
    expect(esc.result()).toBeNull();
    const cancelled = recorder();
    cancelled.recording.cancel();
    await Promise.resolve();
    expect(cancelled.result()).toBeNull();
  });
});

describe("watching single modifier keys", () => {
  const hotkey = new WinHotkey(() => false);

  it("accepts Right Ctrl and Right Alt alone, never the left ones or a plain Ctrl", () => {
    expect(hotkey.accepts("rctrl")).toBe(true);
    expect(hotkey.accepts("ralt")).toBe(true);
    expect(hotkey.accepts("lctrl")).toBe(false);
    expect(hotkey.accepts("ctrl")).toBe(false);
    expect(hotkey.accepts("ctrl+semicolon")).toBe(true);
  });

  it("holds Right Ctrl without taking its own generic Ctrl code for another key", () => {
    const { held, events, tick } = keyboard("rctrl");
    held.add(VK.rctrl).add(VK.control);
    tick();
    tick();
    held.clear();
    tick();
    expect(events.map((event) => event.type)).toEqual(["pressed", "released"]);
  });

  it("holds AltGr as Right Alt: the left Ctrl Windows adds to it is not another key", () => {
    const { held, events, tick } = keyboard("ralt");
    held.add(0xa5).add(VK.alt).add(VK.lctrl).add(VK.control);
    tick();
    tick();
    held.clear();
    tick();
    expect(events.map((event) => event.type)).toEqual(["pressed", "released"]);
  });
});
