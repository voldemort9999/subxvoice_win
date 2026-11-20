// Window chrome for the Mac's hidden-inset title bar.

/** Room for the traffic-light buttons; the strip also drags the window (hiddenInset title bar). */
export function SidebarTop() {
  return <div className="h-12 shrink-0 [-webkit-app-region:drag]" />;
}

/** Class for the top strip of the content area, so it drags the window like a title bar. */
export const TITLE_BAR_DRAG = "[-webkit-app-region:drag]";

export function PermissionsIntro() {
  return (
    <p className="text-ink-soft">
      macOS asks for three permissions. After you allow one in System Settings, this list updates on its own.
    </p>
  );
}

export function HotkeyNote() {
  return (
    <p className="text-ink-soft">
      If the emoji picker opens when you press fn, set System Settings → Keyboard → "Press 🌐 key to" → "Do
      Nothing".
    </p>
  );
}

export function MicrophoneNote() {
  return <p>The microphone turns on only while you hold the hotkey, and turns off as soon as you let go.</p>;
}
