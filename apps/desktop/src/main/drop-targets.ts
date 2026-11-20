import { BrowserWindow, type Rectangle } from "electron";
import type { PillPlace } from "../shared/pill-place";

/**
 * While the pill is dragged: the eight places it can settle, drawn as soft rings over the screen,
 * the nearest one lit. So the user sees where it will land before letting go.
 *
 * Its own window, the size of the screen, transparent and click-through, one level below the pill
 * so the pill passes over the rings. The page is a few lines of inline HTML (no bundle, no preload,
 * no Node): it only draws what it is told through executeJavaScript.
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
#veil{position:fixed;inset:0;background:rgb(10 9 8/0.12);opacity:0;transition:opacity .18s ease-out}
.ring{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
  border:2px dashed rgb(242 232 200/.75);background:rgb(22 20 18/.35);
  transform:scale(.6);opacity:0;transition:transform .22s cubic-bezier(.2,.9,.3,1.3),opacity .18s,background .15s,border-color .15s}
.on .ring{opacity:1;transform:scale(1)}
.on #veil{opacity:1}
.ring.hot{transform:scale(1.45);border:3px solid #fff;background:#5f72ff;
  box-shadow:0 0 0 6px rgb(95 114 255/.28),0 0 26px rgb(95 114 255/.7);animation:pulse 1.1s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 12px rgb(124 139 255/.08),0 0 32px rgb(124 139 255/.6)}}
</style></head><body><div id="veil"></div><script>
function render(spots, hot){
  document.querySelectorAll('.ring').forEach(e=>e.remove());
  for (const s of spots){const d=document.createElement('div');d.className='ring';d.id='r-'+s.place;
    d.style.left=s.x+'px';d.style.top=s.y+'px';document.body.appendChild(d);}
  setHot(hot); requestAnimationFrame(()=>document.body.classList.add('on'));
}
function setHot(hot){document.querySelectorAll('.ring').forEach(e=>e.classList.toggle('hot',e.id==='r-'+hot));}
function fade(){document.body.classList.remove('on');}
</script></body></html>`;

export interface Spot {
  place: PillPlace;
  /** Where the pill's middle would be, relative to the screen area being drawn. */
  x: number;
  y: number;
}

export class DropTargets {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private bounds: Rectangle | null = null;
  private hot: PillPlace | null = null;
  private hideTimer: NodeJS.Timeout | undefined;

  /** Shows the rings for one screen; called again when the drag crosses onto another screen. */
  async show(area: Rectangle, spots: Spot[], hot: PillPlace): Promise<void> {
    clearTimeout(this.hideTimer);
    const window = this.open();
    await this.ready;
    if (window.isDestroyed()) return;
    const same = this.bounds && sameRect(this.bounds, area) && window.isVisible();
    this.hot = hot;
    if (same) return this.highlight(hot);
    this.bounds = area;
    window.setBounds(area);
    window.showInactive();
    await window.webContents.executeJavaScript(`render(${JSON.stringify(spots)}, ${JSON.stringify(hot)})`);
  }

  highlight(hot: PillPlace): void {
    if (!this.window || this.window.isDestroyed() || hot === this.hot) return;
    this.hot = hot;
    void this.window.webContents.executeJavaScript(`setHot(${JSON.stringify(hot)})`).catch(() => {});
  }

  hide(): void {
    const window = this.window;
    if (!window || window.isDestroyed() || !window.isVisible()) return;
    void window.webContents.executeJavaScript("fade()").catch(() => {});
    this.bounds = null;
    this.hot = null;
    // Lets the rings fade before the window goes.
    this.hideTimer = setTimeout(() => {
      if (!window.isDestroyed()) window.hide();
    }, 200);
  }

  private open(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      type: "panel",
      hiddenInMissionControl: true,
      webPreferences: { sandbox: true, contextIsolation: true, javascript: true },
    });
    window.setIgnoreMouseEvents(true);
    // Under the pill (screen-saver level), over everything else.
    window.setAlwaysOnTop(true, "pop-up-menu");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    this.ready = window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`).catch(() => {});
    this.window = window;
    return window;
  }
}

const sameRect = (a: Rectangle, b: Rectangle) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
