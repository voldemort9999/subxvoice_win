/**
 * What the assistant must never do, however the request was phrased or misheard. Ported from the
 * user's computer-mcp (`core/risk.py`, read-only reference), which states each entry as the
 * consequence: the "catastrophic" processes and registry paths there become "never" here, plus the
 * shell, security software and this app (design §3).
 */

/** Lower-case process names, without ".exe". */
const NEVER_PROCESSES: Record<string, string> = {
  lsass: "it holds every credential on this PC — Windows crashes and reboots at once",
  csrss: "Windows crashes and reboots at once",
  wininit: "Windows crashes and reboots at once",
  services: "it runs every Windows service — Windows crashes and reboots",
  smss: "Windows crashes and reboots at once",
  winlogon: "the session is destroyed and the PC reboots",
  explorer: "it is the desktop and taskbar the user is working in",
  dwm: "the screen goes blank until Windows restarts it",
  svchost: "it hosts Windows services — networking, audio and more stop",
  sihost: "the Start menu and notifications stop working",
  msmpeng: "it is Windows Defender; stopping security software is never done by voice",
  nissrv: "it is Windows Defender's network protection",
  securityhealthservice: "it is Windows Security",
  subxvoice: "it is this assistant",
};

/** Lower-case registry path fragments whose wrong value stops Windows booting or signing in. */
const NEVER_REGISTRY: [string, string][] = [
  [String.raw`system\currentcontrolset\control\session manager`, "a wrong value here stops Windows booting"],
  [
    String.raw`system\currentcontrolset\services`,
    "drivers and services start from here; a mistake can stop boot",
  ],
  [
    String.raw`software\microsoft\windows nt\currentversion\winlogon`,
    "a wrong value means signing in shows a blank screen",
  ],
  [String.raw`system\currentcontrolset\control\class`, "device drivers load from here"],
  [String.raw`\bcd0000000`, "it is the boot configuration"],
  [String.raw`system\currentcontrolset\control\lsa`, "it controls how Windows checks passwords"],
  [
    String.raw`system\currentcontrolset\control\safeboot`,
    "it is how Safe Mode starts — the way to repair the PC",
  ],
];

/** Why stopping this process is never allowed, or undefined when it is an ordinary program. */
export function neverProcess(name: string): string | undefined {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, "");
  return NEVER_PROCESSES[key];
}

/** Why writing here is never allowed, or undefined for an ordinary location. */
export function neverRegistry(path: string): string | undefined {
  const lowered = path.toLowerCase().replaceAll("/", "\\");
  return NEVER_REGISTRY.find(([fragment]) => lowered.includes(fragment))?.[1];
}
