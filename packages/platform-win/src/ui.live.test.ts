import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { afterAll, describe, expect, it } from "vitest";
import type { WindowInfo } from "./commands";
import { INTEROP } from "./interop";
import { PowerShellWorker } from "./powershell";
import { WinScreenDriver } from "./screen";

/**
 * The `ui` tool's driver on this machine — opt-in with LIVE=1. Shows a small test window and acts
 * on it through UIA patterns only (no mouse, no keys); reads WhatsApp's tree when it is running,
 * which brings WhatsApp to the front.
 */
const live = process.env.LIVE === "1" && process.platform === "win32";

/**
 * WPF, not WinForms: WPF controls are native UIA providers, as WinUI/WhatsApp and Chromium are.
 * A WinForms ComboBox in a PowerShell host is a legacy MSAA object with no ExpandCollapse, and its
 * ListBox takes a UIA select as LB_SETCURSEL without raising SelectedIndexChanged — both seen here.
 */
const FORM = String.raw`
Add-Type -AssemblyName PresentationFramework
$w = New-Object System.Windows.Window
$w.Title = 'SubxUiTest'; $w.WindowStartupLocation = 'Manual'; $w.Left = 360; $w.Top = 300; $w.Width = 420; $w.Height = 300
$panel = New-Object System.Windows.Controls.StackPanel
$button = New-Object System.Windows.Controls.Button; $button.Content = 'Press me'
$list = New-Object System.Windows.Controls.ListBox; [void]$list.Items.Add('Alpha'); [void]$list.Items.Add('Beta')
$combo = New-Object System.Windows.Controls.ComboBox; [void]$combo.Items.Add('Small'); [void]$combo.Items.Add('Large')
[void]$panel.Children.Add($button); [void]$panel.Children.Add($list); [void]$panel.Children.Add($combo)
$w.Content = $panel
$say = { param($t) [Console]::Out.WriteLine($t); [Console]::Out.Flush() }
$button.Add_Click({ & $say 'INVOKED' })
$list.Add_SelectionChanged({ & $say ('SELECTED ' + $list.SelectedItem) })
$combo.Add_DropDownOpened({ & $say 'EXPANDED' })
$w.Add_ContentRendered({ & $say 'READY' })
[void]$w.ShowDialog()
`;

describe.skipIf(!live)("WinScreenDriver for the ui tool on this machine", () => {
  const worker = new PowerShellWorker(INTEROP);
  const windows = () => worker.json<WindowInfo[]>("[CmdWindows]::List()");
  const driver = new WinScreenDriver(worker, {
    windows,
    inserter: { insert: async () => {} },
    launchNamed: async () => false,
  });
  let form: ChildProcess | null = null;
  afterAll(() => {
    form?.kill();
    worker.dispose();
  });

  it("reads elements with physical bounds and acts through invoke, select and expand", async () => {
    form = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", FORM]);
    const heard: string[] = [];
    const lines = createInterface({ input: form.stdout as NodeJS.ReadableStream });
    lines.on("line", (line) => heard.push(line));
    const until = async (text: string) => {
      for (let i = 0; i < 50 && !heard.includes(text); i++) await new Promise((r) => setTimeout(r, 100));
      return heard.includes(text);
    };
    expect(await until("READY")).toBe(true);

    const snapshot = await driver.read("SubxUiTest");
    const find = (role: string, name: string) =>
      snapshot.elements.find((e) => e.role === role && e.name === name);
    const button = find("Button", "Press me");
    const beta = find("ListItem", "Beta");
    const size = snapshot.elements.find((e) => e.role === "ComboBox");
    console.log(JSON.stringify({ button, beta, size }));
    expect(button?.bounds?.length).toBe(4);
    expect((button?.bounds?.[2] ?? 0) > (button?.bounds?.[0] ?? 0)).toBe(true);

    await driver.act(button?.id ?? -1, "invoke");
    expect(await until("INVOKED")).toBe(true);
    await driver.act(beta?.id ?? -1, "select");
    expect(await until("SELECTED Beta")).toBe(true);
    await driver.act(size?.id ?? -1, "expand");
    expect(await until("EXPANDED")).toBe(true);
    await expect(driver.act(button?.id ?? -1, "expand")).rejects.toThrow(/cannot expand/);
  }, 60_000);

  it("lists WhatsApp's search box with its bounds", async () => {
    if (!(await windows()).some((w) => /whatsapp/i.test(w.program))) {
      console.log("WhatsApp is not running; skipped");
      return;
    }
    const snapshot = await driver.read("WhatsApp");
    const search = snapshot.elements.find((e) => e.editable && /search/i.test(e.name));
    console.log(`WhatsApp: ${snapshot.elements.length} elements; search box:`, JSON.stringify(search));
    expect(search?.bounds?.length).toBe(4);
  }, 60_000);
});
