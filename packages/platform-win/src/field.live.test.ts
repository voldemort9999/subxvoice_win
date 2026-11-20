import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { WinSystem } from "./system";
import { foregroundWindow } from "./win32";

/**
 * Reading back the box a dictation went into, on this machine — opt-in with LIVE=1. Shows a small
 * WPF window for a few seconds with one box focused; the mouse and keyboard are not touched.
 * A RichTextBox has a Text pattern and no Value, like Chromium's editable divs (WhatsApp, Gmail):
 * those ended every learning watch with "could not read the field" (Windows hand test, 2026-11-20).
 */
const live = process.env.LIVE === "1" && process.platform === "win32";

const WINDOW = (box: "rich" | "plain") => String.raw`
Add-Type -AssemblyName PresentationFramework
$w = New-Object System.Windows.Window
$w.Title = 'SubxFieldTest'; $w.Width = 420; $w.Height = 160; $w.Topmost = $true
if ('${box}' -eq 'rich') {
  $b = New-Object System.Windows.Controls.RichTextBox
  $b.Document.Blocks.Clear()
  $b.Document.Blocks.Add((New-Object System.Windows.Documents.Paragraph (New-Object System.Windows.Documents.Run 'Aarnav ko message kar dena')))
} else {
  $b = New-Object System.Windows.Controls.TextBox
  $b.Text = 'kal parso office aaunga'
}
$w.Content = $b
$w.Add_ContentRendered({ $w.Activate(); [void]$b.Focus(); [Console]::Out.WriteLine('READY'); [Console]::Out.Flush() })
[void]$w.ShowDialog()
`;

describe.skipIf(!live)("reading the focused box on this machine", () => {
  let window: ChildProcess | null = null;
  const system = new WinSystem();
  afterAll(() => system.dispose());
  afterEach(() => {
    window?.kill();
    window = null;
  });

  /** False when Windows kept the focus elsewhere (the user is busy in another app). */
  async function show(box: "rich" | "plain"): Promise<boolean> {
    window = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", WINDOW(box)]);
    await new Promise<string>((resolve) =>
      createInterface({ input: window?.stdout as NodeJS.ReadableStream }).once("line", resolve),
    );
    // Until Windows has given the window the focus: reading before that reads whatever had it.
    for (let tries = 0; tries < 25; tries++) {
      if (foregroundWindow()?.title === "SubxFieldTest") return true;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  }

  it("reads a box that has only a Text pattern (Chromium's editable divs)", async (ctx) => {
    // Never read a box of the user's own: without the focus, the test does not run.
    if (!(await show("rich"))) ctx.skip();
    const text = await system.focusedText();
    console.log("rich:", JSON.stringify(text));
    expect(text).toContain("Aarnav ko message kar dena");
  }, 30_000);

  it("still reads a box with a Value", async (ctx) => {
    if (!(await show("plain"))) ctx.skip();
    const text = await system.focusedText();
    console.log("plain:", JSON.stringify(text));
    expect(text).toBe("kal parso office aaunga");
  }, 30_000);
});
