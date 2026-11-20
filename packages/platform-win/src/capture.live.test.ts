import { type ChildProcess, execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, WinScreenCapture } from "./capture";
import type { WindowInfo } from "./commands";
import { INTEROP } from "./interop";
import { PowerShellWorker } from "./powershell";

/**
 * Real screenshots of this machine — opt-in with LIVE=1. It shows a small always-on-top window with
 * a filled password box, and a Chrome window on a throwaway profile, for a few seconds each, and
 * closes them; the mouse and keyboard are not touched.
 */
const live = process.env.LIVE === "1" && process.platform === "win32";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

/**
 * A separate, per-monitor-aware PowerShell shows the form (UIA must not query a window on its own
 * thread) and prints the password box's physical screen rectangle once it is up.
 */
const FORM = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Name Dpi -Namespace Subx -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr c);'
[void][Subx.Dpi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
$form = New-Object System.Windows.Forms.Form
$form.Text = 'SubxPasswordTest'; $form.TopMost = $true; $form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(300, 300); $form.Size = New-Object System.Drawing.Size(420, 200)
$box = New-Object System.Windows.Forms.TextBox
$box.UseSystemPasswordChar = $true; $box.Text = 'hunter2hunter2'; $box.Width = 300; $box.Location = New-Object System.Drawing.Point(40, 50)
$box.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($box)
$form.Add_Shown({ $p = $box.PointToScreen([System.Drawing.Point]::Empty); [Console]::Out.WriteLine("$($p.X),$($p.Y),$($box.Width),$($box.Height)"); [Console]::Out.Flush() })
[System.Windows.Forms.Application]::Run($form)
`;

/** Pixels inside a rectangle of a base64 image that are not black, counted in PowerShell. */
const notBlack = (data: string, x: number, y: number, w: number, h: number) => `
$bytes = [Convert]::FromBase64String('${data}')
$bmp = New-Object System.Drawing.Bitmap (New-Object System.IO.MemoryStream (,$bytes))
$n = 0
for ($i = ${x}; $i -lt ${x + w}; $i++) { for ($j = ${y}; $j -lt ${y + h}; $j++) {
  $c = $bmp.GetPixel($i, $j); if ($c.R -gt 8 -or $c.G -gt 8 -or $c.B -gt 8) { $n++ } } }
$bmp.Dispose(); $n`;

describe.skipIf(!live)("WinScreenCapture on this machine", () => {
  const worker = new PowerShellWorker([...INTEROP, "Add-Type -AssemblyName System.Drawing"]);
  const windows = () => worker.json<WindowInfo[]>("[CmdWindows]::List()");
  const capture = new WinScreenCapture(worker, { windows });
  let form: ChildProcess | null = null;
  afterAll(() => {
    form?.kill();
    worker.dispose();
  });

  it("captures the foreground display within the model's limits", async () => {
    const started = Date.now();
    const shot = await capture.screenshot();
    console.log(
      `screenshot ${shot.width}x${shot.height} of`,
      shot.display,
      `${Date.now() - started} ms,`,
      `${Math.round((shot.data.length * 3) / 4 / 1024)} KB ${shot.mimeType}, redacted ${shot.redacted}`,
    );
    expect(Math.max(shot.width, shot.height)).toBeLessThanOrEqual(DEFAULT_LIMITS.maxLongEdge);
    expect(shot.width * shot.height).toBeLessThanOrEqual(DEFAULT_LIMITS.maxPixels * 1.01);
    // The bytes are an image of exactly the size reported.
    const size = await worker.run(
      `$b = New-Object System.Drawing.Bitmap (New-Object System.IO.MemoryStream (,[Convert]::FromBase64String('${shot.data}'))); "$($b.Width)x$($b.Height)"`,
    );
    expect(size).toBe(`${shot.width}x${shot.height}`);
    // The far corner is this display's last pixel, never the next display's first.
    expect(capture.toPhysical(shot.width, shot.height)).toEqual([
      shot.display.x + shot.display.width - 1,
      shot.display.y + shot.display.height - 1,
    ]);
  }, 30_000);

  it("blacks out a filled password box before the image leaves", async () => {
    form = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", FORM], { windowsHide: false });
    const line = await new Promise<string>((resolve, reject) => {
      createInterface({ input: form?.stdout as NodeJS.ReadableStream }).once("line", resolve);
      form?.once("exit", () => reject(new Error("form exited")));
    });
    const [bx, by, bw, bh] = line.split(",").map(Number) as [number, number, number, number];
    await new Promise((resolve) => setTimeout(resolve, 500));

    const started = Date.now();
    const shot = await capture.screenshot({ windowHint: "SubxPasswordTest" });
    console.log(`with password window: ${Date.now() - started} ms, redacted ${shot.redacted}`);
    expect(shot.redacted).toBeGreaterThanOrEqual(1);

    // The box in image pixels, shrunk by a pixel or two so scaling's rounding at the edge is not counted.
    const sx = shot.width / shot.display.width;
    const sy = shot.height / shot.display.height;
    const x = Math.ceil((bx - shot.display.x) * sx) + 2;
    const y = Math.ceil((by - shot.display.y) * sy) + 2;
    const w = Math.floor(bw * sx) - 4;
    const h = Math.floor(bh * sy) - 4;
    expect(Number(await worker.run(notBlack(shot.data, x, y, w, h)))).toBe(0);
    // And the form around it was not blacked: its white client area just below the box.
    expect(
      Number(await worker.run(notBlack(shot.data, x, y + h + Math.ceil(30 * sy), w, 4))),
    ).toBeGreaterThan(0);

    // Zoom on the box: still black at the larger size.
    const zoomed = await capture.zoom([x - 10, y - 10, x + w + 10, y + h + 10]);
    const zx = zoomed.width / zoomed.display.width;
    const zy = zoomed.height / zoomed.display.height;
    expect(zoomed.redacted).toBeGreaterThanOrEqual(1);
    console.log(`zoom ${zoomed.width}x${zoomed.height} of`, zoomed.display);
    // Blown up ~5x, bicubic blends a couple of source pixels at the box's edge: stay 3 physical
    // pixels inside it.
    const [mx, my] = [Math.ceil(3 * zx), Math.ceil(3 * zy)];
    expect(
      Number(
        await worker.run(
          notBlack(
            zoomed.data,
            Math.ceil((bx - zoomed.display.x) * zx) + mx,
            Math.ceil((by - zoomed.display.y) * zy) + my,
            Math.floor(bw * zx) - 2 * mx,
            Math.floor(bh * zy) - 2 * my,
          ),
        ),
      ),
    ).toBe(0);
  }, 60_000);

  // A fresh profile, so Chrome's accessibility is off until our first read — as on a machine where
  // nothing has asked yet. The first screenshot used to find nothing here.
  it.skipIf(!existsSync(CHROME))(
    "hides a fresh Chrome's password field on the very first screenshot",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "subx-chrome-"));
      writeFileSync(
        join(dir, "pw.html"),
        `<title>SubxChromePw</title><body style="margin:60px"><input type=password value="hunter2hunter2" style="width:300px;height:30px">`,
      );
      const chrome = spawn(CHROME, [
        `--user-data-dir=${join(dir, "profile")}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        join(dir, "pw.html"),
      ]);
      try {
        for (let i = 0; i < 40 && !(await windows()).some((w) => w.title.includes("SubxChromePw")); i++)
          await new Promise((resolve) => setTimeout(resolve, 250));
        await new Promise((resolve) => setTimeout(resolve, 800));
        const started = Date.now();
        const shot = await capture.screenshot({ windowHint: "SubxChromePw" });
        console.log(`fresh Chrome: ${Date.now() - started} ms, redacted ${shot.redacted}`);
        expect(shot.redacted).toBeGreaterThanOrEqual(1);
      } finally {
        try {
          execSync(`taskkill /F /T /PID ${chrome.pid}`, { stdio: "ignore" });
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
