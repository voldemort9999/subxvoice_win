import { describe, expect, it } from "vitest";
import {
  appWindow,
  bareName,
  matchWindows,
  nearestChat,
  plainSpelling,
  WinCommandSource,
  type WindowInfo,
} from "./commands";

describe("plainSpelling (laptop demo: 'Aaryan' never found the chat 'Aryan')", () => {
  it("makes doubled letters single", () => {
    expect(plainSpelling("Aaryan")).toBe("Aryan");
    expect(plainSpelling("Priyaa")).toBe("Priya");
    expect(plainSpelling("Aryan")).toBe("Aryan");
  });
});

describe("bareName (demo hand test, 2026-11-19: 'WhatsApp bolo aur Dragon ko message karo')", () => {
  it("drops the spoken words that came along with the name", () => {
    expect(bareName("Bolo aur Dragon")).toBe("Dragon");
    expect(bareName("Dragon ko")).toBe("Dragon");
    expect(bareName("WhatsApp pe Aryan")).toBe("Aryan");
  });

  it("leaves a real name alone, and never empties one", () => {
    expect(bareName("Dragon Bhai")).toBe("Dragon Bhai");
    expect(bareName("Yash Arya")).toBe("Yash Arya");
    expect(bareName("Bolo")).toBe("Bolo");
  });
});

describe("write_email (laptop demo: an empty Gmail page, then 'kisko mail karun?' again and again)", () => {
  async function write(args: Record<string, unknown>) {
    const opened: string[] = [];
    const source = new WinCommandSource({
      inserter: { insert: async () => {} },
      openUrl: async (url) => void opened.push(url),
    });
    const action = (await source.actions()).find((a) => a.id === "write_email");
    if (!action) throw new Error("no write_email");
    const result = await action.run(args);
    return { url: new URL(opened[0] ?? ""), result };
  }

  it("opens Gmail's new email with the subject and the whole message written in", async () => {
    const { url, result } = await write({
      subject: "Leave tomorrow",
      body: "Dear Sir,\nMain kal leave par rahunga.\nRegards",
    });
    expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("su")).toBe("Leave tomorrow");
    expect(url.searchParams.get("body")).toBe("Dear Sir,\nMain kal leave par rahunga.\nRegards");
    expect(url.searchParams.has("to")).toBe(false);
    expect(result.did).toMatch(/no address yet/);
  });

  it("fills the address when the user gave one", async () => {
    const { url } = await write({ to: "batchmanager@gmail.com", subject: "s", body: "b" });
    expect(url.searchParams.get("to")).toBe("batchmanager@gmail.com");
  });
});

describe("nearestChat", () => {
  it("names the chat a misheard name is nearest to, from WhatsApp's rows as UIA gives them", () => {
    const rows = ["2 unread messages Aryan Monday hi", "Arjun Yesterday ok", "@MCUPortal (You) photo"];
    expect(nearestChat("Aryn", rows)).toBe("Aryan");
    expect(nearestChat("Zzz", rows)).toBeNull();
  });
});

describe("appWindow", () => {
  it("finds an app's open window by its title or program, punctuation aside", () => {
    const windows = [
      win(1, "Hinglish - Google Chrome", "chrome"),
      win(2, "WhatsApp", "WhatsApp.Root"),
      win(3, "BlueStacks Multi Instance Manager", "HD-MultiInstanceManager"),
    ];
    expect(appWindow("WhatsApp", windows)?.handle).toBe(2);
    expect(appWindow("BlueStacks Multi-Instance Manager", windows)?.handle).toBe(3);
    expect(appWindow("Spotify", windows)).toBeUndefined();
  });
});

const win = (handle: number, title: string, program = "Notepad"): WindowInfo => ({
  handle,
  title,
  program,
  pid: handle,
  state: "normal",
  foreground: handle === 1,
});

describe("matchWindows", () => {
  const notepads = [win(1, "Untitled - Notepad"), win(2, "Untitled - Notepad"), win(3, "Untitled - Notepad")];

  it("gives one window per time a title is named — three names, three Notepads (S-024)", () => {
    const taken = new Set<number>();
    for (let i = 0; i < 3; i++)
      for (const window of matchWindows("Untitled - Notepad", notepads, false, taken))
        taken.add(window.handle);
    expect([...taken]).toEqual([1, 2, 3]);
  });

  it("named once, still only the topmost: closing never widens by itself", () => {
    expect(matchWindows("Untitled - Notepad", notepads, false).map((w) => w.handle)).toEqual([1]);
  });

  it("finds a title spelt with a hyphen where the window has a space", () => {
    const windows = [win(9, "BlueStacks Multi Instance Manager", "HD-MultiInstanceManager")];
    expect(matchWindows("BlueStacks Multi-Instance Manager", windows, false).map((w) => w.handle)).toEqual([
      9,
    ]);
  });
});
