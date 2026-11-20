// Window chrome and platform notes for Windows: the window keeps Windows' own title bar (main
// index.ts, titleBarStyle "default"), so nothing here drags it or leaves room for buttons.

/** A little air above the sidebar's first item; the title bar is Windows' own. */
export function SidebarTop() {
  return <div className="h-3 shrink-0" />;
}

/** Windows' own title bar drags the window; the content strip does not. */
export const TITLE_BAR_DRAG = "";

export function PermissionsIntro() {
  return (
    <p className="text-ink-soft">
      Windows asks for one permission: the microphone. If dictation hears nothing, turn on "Let desktop apps
      access your microphone" in Settings → Privacy &amp; security → Microphone.
    </p>
  );
}

export function HotkeyNote() {
  return (
    <p className="text-ink-soft">
      Ctrl + Win is the default. Whatever key you set works in every app, so pick one that no app you use
      needs.
    </p>
  );
}

export function MicrophoneNote() {
  return <p>The microphone turns on only while you hold the hotkey, and turns off as soon as you let go.</p>;
}
