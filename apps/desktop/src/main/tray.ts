import { Menu, Tray } from "electron";
import { brandIcon } from "./brand";

/** The system tray icon: the way to open the dashboard or quit. */
export function createTray(openDashboard: () => void): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip("SUBXVoice");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open SUBXVoice", click: openDashboard },
      { type: "separator" },
      { label: "Quit SUBXVoice", role: "quit" },
    ]),
  );
  return tray;
}

const SIZE = 32; // drawn at twice the 16 px tray size, so it stays sharp on high-DPI screens

/**
 * Windows draws tray icons in full colour on a taskbar that can be light or dark, and white bars
 * alone vanish on a light one — so the tray gets the whole mark, plate and Marigold included.
 */
function trayIcon() {
  return brandIcon(SIZE);
}
