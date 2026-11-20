import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { afterAll, describe, expect, it } from "vitest";
import { INTEROP } from "./interop";
import { PowerShellWorker } from "./powershell";
import { WinScreenProbe } from "./probe";

/**
 * The guard's eyes on this machine — opt-in with LIVE=1. Shows a small window for a few seconds:
 * a "Send" button (a real control) and a picture with "Place order" drawn into its pixels (what a
 * canvas shop or an emulator looks like). Reads only; the mouse and keyboard are not touched.
 */
const live = process.env.LIVE === "1" && process.platform === "win32";

const FORM = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Name D -Namespace Subx -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr c);'
[void][Subx.D]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
$form = New-Object System.Windows.Forms.Form
$form.Text = 'SubxProbeTest'; $form.TopMost = $true; $form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(340, 280); $form.Size = New-Object System.Drawing.Size(520, 300)
$send = New-Object System.Windows.Forms.Button
$send.Text = 'Send'; $send.Location = New-Object System.Drawing.Point(30, 30); $send.Size = New-Object System.Drawing.Size(120, 40)
$bmp = New-Object System.Drawing.Bitmap 420, 90
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Segoe UI', 26)
$g.DrawString('Place order', $font, [System.Drawing.Brushes]::Black, 20, 15); $g.Dispose()
$pic = New-Object System.Windows.Forms.PictureBox
$pic.Image = $bmp; $pic.Location = New-Object System.Drawing.Point(30, 110); $pic.Size = New-Object System.Drawing.Size(420, 90)
$form.Controls.Add($send); $form.Controls.Add($pic)
function Centre($c) { $p = $c.PointToScreen([System.Drawing.Point]::Empty); "$($p.X + [int]($c.Width / 2)),$($p.Y + [int]($c.Height / 2))" }
$form.Add_Shown({ [Console]::Out.WriteLine("AT $(Centre $send);$(Centre $pic)"); [Console]::Out.Flush() })
[System.Windows.Forms.Application]::Run($form)
`;

describe.skipIf(!live)("WinScreenProbe on this machine", () => {
  const worker = new PowerShellWorker(INTEROP);
  const probe = new WinScreenProbe(worker);
  let form: ChildProcess | null = null;
  afterAll(() => {
    form?.kill();
    worker.dispose();
  });

  it("names the control under a point and reads the label drawn in pixels", async () => {
    form = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", FORM]);
    const line = await new Promise<string>((resolve) =>
      createInterface({ input: form?.stdout as NodeJS.ReadableStream }).once("line", resolve),
    );
    const [send, pic] = line
      .slice(3)
      .split(";")
      .map((p) => p.split(",").map(Number) as [number, number]) as [[number, number], [number, number]];
    await new Promise((resolve) => setTimeout(resolve, 600));

    const chain = await probe.elementAt(...send);
    console.log("chain at Send:", JSON.stringify(chain));
    expect(chain.some((node) => node.role === "Button" && node.name === "Send")).toBe(true);

    let started = Date.now();
    const lines = await probe.textNear(...pic);
    console.log(`OCR (first, loads WinRT) ${Date.now() - started} ms:`, JSON.stringify(lines));
    expect(lines.some((l) => /place order/i.test(l.text))).toBe(true);
    const hit = lines.find((l) => /place order/i.test(l.text));
    // The line's box is in physical pixels and covers the picture's centre band.
    expect(hit && Math.abs(hit.box.y + hit.box.height / 2 - pic[1]) < 40).toBe(true);

    started = Date.now();
    await probe.textNear(...pic);
    console.log(`OCR (warm) ${Date.now() - started} ms`);

    const focus = await probe.focused();
    console.log("focus:", JSON.stringify(focus));
    expect(typeof focus?.program).toBe("string");
  }, 60_000);
});
