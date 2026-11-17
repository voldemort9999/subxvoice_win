// The window's chrome and the Windows-specific notes shown in Settings.

/** Windows keeps its native title bar, so the sidebar only needs breathing room above the brand. */
export function SidebarTop() {
  return <div className="h-3 shrink-0" />;
}

/** Windows has a native title bar; the content area does not need to drag the window. */
export const TITLE_BAR_DRAG = "";

export function PermissionsIntro() {
  return (
    <p className="text-ink-soft">
      Allow microphone access in Windows Settings. Text can't be typed into apps that run as administrator.
    </p>
  );
}

export function MicrophoneNote() {
  return (
    <p>
      The microphone stays ready for a minute after you dictate, so your first word is never cut off. Windows
      shows the microphone icon during that minute.
    </p>
  );
}
