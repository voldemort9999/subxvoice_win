import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { afterAll, describe, expect, it } from "vitest";
import { WinScreenCapture } from "./capture";
import type { WindowInfo } from "./commands";
import { WinScreenInput } from "./input";
import { INTEROP } from "./interop";
import { PowerShellWorker } from "./powershell";
import { getCursorPos, isKeyDown, setCursorPos, VK } from "./win32";

/**
 * Real mouse and keyboard on this machine — opt-in with LIVE=1, and only with the user told first:
 * it moves the mouse, clicks and types into a small test window of its own, then puts the cursor
 * back and closes the window.
 */
const live = process.env.LIVE === "1" && process.platform === "win32";

/**
 * A DPI-unaware window (the case Windows bitmap-scales on a 125–150% display, where a click is
 * easiest to land wrong), in its own PowerShell. Prints its controls' physical rectangles and the
 * display's scale, then "TEXT <base64>" when its button is clicked.
 */
const FORM = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Name W -Namespace Subx -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr SetThreadDpiAwarenessContext(System.IntPtr c);
[DllImport("user32.dll")] public static extern bool LogicalToPhysicalPointForPerMonitorDPI(System.IntPtr h, ref System.Drawing.Point p);
[DllImport("user32.dll")] public static extern System.IntPtr MonitorFromWindow(System.IntPtr h, uint f);
[DllImport("shcore.dll")] public static extern int GetDpiForMonitor(System.IntPtr m, int t, out uint x, out uint y);
'@ -ReferencedAssemblies System.Drawing
[void][Subx.W]::SetThreadDpiAwarenessContext([IntPtr]::new(-1))
$form = New-Object System.Windows.Forms.Form
$form.Text = 'SubxInputTest'; $form.TopMost = $true; $form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(320, 260); $form.Size = New-Object System.Drawing.Size(460, 220)
$box = New-Object System.Windows.Forms.TextBox
$box.Width = 380; $box.Location = New-Object System.Drawing.Point(30, 30)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Done'; $button.Width = 120; $button.Height = 40; $button.Location = New-Object System.Drawing.Point(150, 90)
$form.Controls.Add($box); $form.Controls.Add($button)
function Rect($c) {
  $a = $c.PointToScreen([System.Drawing.Point]::Empty); $b = New-Object System.Drawing.Point(($a.X + $c.Width), ($a.Y + $c.Height))
  [void][Subx.W]::LogicalToPhysicalPointForPerMonitorDPI($form.Handle, [ref]$a); [void][Subx.W]::LogicalToPhysicalPointForPerMonitorDPI($form.Handle, [ref]$b)
  "$($a.X),$($a.Y),$($b.X),$($b.Y)"
}
$button.Add_Click({ [Console]::Out.WriteLine('TEXT ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($box.Text))); [Console]::Out.Flush() })
$form.Add_Shown({
  $dx = [uint32]0; $dy = [uint32]0
  [void][Subx.W]::GetDpiForMonitor([Subx.W]::MonitorFromWindow($form.Handle, 2), 0, [ref]$dx, [ref]$dy)
  [Console]::Out.WriteLine("RECTS $(Rect $box);$(Rect $button);$dx"); [Console]::Out.Flush()
})
[System.Windows.Forms.Application]::Run($form)
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!live)("WinScreenInput on this machine", () => {
  const worker = new PowerShellWorker(INTEROP);
  const windows = () => worker.json<WindowInfo[]>("[CmdWindows]::List()");
  const capture = new WinScreenCapture(worker, { windows });
  const input = new WinScreenInput(capture);
  const cursorBefore = getCursorPos();
  let form: ChildProcess | null = null;
  afterAll(async () => {
    await input.releaseAll();
    setCursorPos(...cursorBefore);
    form?.kill();
    worker.dispose();
  });

  it("clicks into a DPI-scaled window, types Devanagari and English, and clicks its button", async () => {
    form = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", FORM]);
    const lines = createInterface({ input: form.stdout as NodeJS.ReadableStream });
    const next = (prefix: string) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${prefix} line`)), 15_000);
        lines.on("line", (line) => {
          if (!line.startsWith(prefix)) return;
          clearTimeout(timer);
          resolve(line.slice(prefix.length + 1));
        });
      });
    const [boxRect, buttonRect, dpi] = (await next("RECTS")).split(";") as [string, string, string];
    console.log(
      `display scale ${Math.round((Number(dpi) / 96) * 100)}%, box ${boxRect}, button ${buttonRect}`,
    );
    await sleep(500);

    await capture.screenshot({ windowHint: "SubxInputTest" });
    const centre = (rect: string) => {
      const [x0, y0, x1, y1] = rect.split(",").map(Number) as [number, number, number, number];
      return capture.toShot((x0 + x1) / 2, (y0 + y1) / 2);
    };
    const text = next("TEXT");
    await input.click(...centre(boxRect));
    await sleep(300);
    await input.type("नमस्ते hello");
    await sleep(300);
    await input.click(...centre(buttonRect));
    expect(Buffer.from(await text, "base64").toString("utf8")).toBe("नमस्ते hello");
    expect(input.lastInjectedAt()).toBeGreaterThan(Date.now() - 5000);
  }, 60_000);

  it("lets go of a held key when the hold is aborted", async () => {
    const abort = new AbortController();
    const held = input.holdKey("shift", 5, abort.signal);
    await sleep(200);
    expect(isKeyDown(VK.shift)).toBe(true);
    abort.abort();
    await held;
    await input.releaseAll();
    expect([VK.shift, VK.control, VK.alt, VK.lwin, 0x01].some(isKeyDown)).toBe(false);
  }, 15_000);
});
