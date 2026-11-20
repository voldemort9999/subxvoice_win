/**
 * C# that PowerShell compiles once per worker (Add-Type), for the Windows APIs that are COM or that
 * need callbacks — awkward from koffi, routine from C#.
 *
 * AUDIO is copied unchanged from the personal computer-mcp (`core/audio.py`), where it was audited:
 * IAudioEndpointVolume for the system volume, ISimpleAudioVolume per app session, and the
 * undocumented IPolicyConfig that every third-party device switcher uses. WINDOWS is that project's
 * `core/windows.py` translated from ctypes to C#, keeping its three hard-won rules: the shell's
 * taskbar filter, cloaked-is-not-hidden, and attaching input queues to take the foreground.
 *
 * `String.raw`, because the C# is full of backslash escapes (`"\\"`) that a plain template
 * literal would consume before PowerShell ever saw them.
 *
 * Both compile under Windows PowerShell 5.1's Add-Type, which is C# 5 — no interpolated strings,
 * no `out var`, no expression-bodied members.
 */

const AUDIO = String.raw`
using System;
using System.Runtime.InteropServices;

[Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {
  int GetMixFormat(); int GetDeviceFormat(); int ResetDeviceFormat(); int SetDeviceFormat();
  int GetProcessingPeriod(); int SetProcessingPeriod(); int GetShareMode(); int SetShareMode();
  int GetPropertyValue(); int SetPropertyValue();
  int SetDefaultEndpoint([In, MarshalAs(UnmanagedType.LPWStr)] string id, [In] int role);
  int SetEndpointVisibility();
}
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class CPolicyConfigClient { }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection col);
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
}
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { int GetCount(out int n); int Item(int i, out IMMDevice d); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  int OpenPropertyStore(int access, out IPropertyStore store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetState(out int state);
}
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  int GetCount(out int n); int GetAt(int i, out PropertyKey k);
  int GetValue(ref PropertyKey k, out PropVariant v);
}
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr n); int UnregisterControlChangeNotify(IntPtr n);
  int GetChannelCount(out int n);
  int SetMasterVolumeLevel(float db, Guid ctx);
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int GetMasterVolumeLevel(out float db);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(int ch, float db, Guid ctx);
  int SetChannelVolumeLevelScalar(int ch, float level, Guid ctx);
  int GetChannelVolumeLevel(int ch, out float db);
  int GetChannelVolumeLevelScalar(int ch, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
// Per-application volume. Windows keeps one "session" per program that has
// opened audio, each with its own volume and mute, and this is the same set
// the Volume Mixer shows. The session's own display name is usually empty -
// most programs never set it - so the name shown comes from the owning
// process instead, which is what a person recognises anyway.
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
  int GetAudioSessionControl(IntPtr id, int flags, out IntPtr ctl);
  int GetSimpleAudioVolume(IntPtr id, int flags, out ISimpleAudioVolume vol);
  int GetSessionEnumerator(out IAudioSessionEnumerator e);
}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
  int GetCount(out int n);
  int GetSession(int i, out IAudioSessionControl2 s);
}
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  // IAudioSessionControl has exactly nine methods before this interface adds
  // its own, and the count is the whole game: a vtable declared one slot long
  // does not fail, it calls the neighbouring method. Declaring two placeholders
  // here instead of GetState made every later slot point one too far, so
  // "GetProcessId" was really IsSystemSoundsSession - it returned S_OK/S_FALSE
  // and never touched the pid, leaving it 0 for every session. Every program
  // then grouped under pid 0 and the mixer showed one row called "System
  // sounds", so "turn Chrome down" had nothing to aim at. It looked correct
  // until something other than Windows itself was actually playing.
  int GetState(out int state);
  int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string v, ref Guid ctx);
  int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
  int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string v, ref Guid ctx);
  int GetGroupingParam(out Guid g); int SetGroupingParam(ref Guid g, ref Guid ctx);
  int NotImpl2(); int NotImpl3();
  int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetProcessId(out uint pid);
  // [PreserveSig] matters here and nowhere else in this interface, because
  // this is the only method whose answer *is* the HRESULT: S_OK means "yes,
  // system sounds", S_FALSE means "no". Every other method answers through an
  // out parameter, so the runtime's default - swallow the HRESULT, raise on
  // failure - loses nothing. Here it lost everything: the declared int came
  // back as 0 whatever the session was, so every program in the mixer was
  // reported as the system-sounds session, Chrome included.
  [PreserveSig] int IsSystemSoundsSession();
  int SetDuckingPreference(bool opt);
}
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
  int SetMasterVolume(float level, ref Guid ctx);
  int GetMasterVolume(out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

[StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)] struct PropVariant {
  [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p;
  public string Str() { return Marshal.PtrToStringUni(p); }
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorObj { }

public class CmcpAudio {
  // PKEY_Device_FriendlyName
  static PropertyKey NameKey = new PropertyKey {
    fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };

  static IMMDeviceEnumerator Enum() {
    return (IMMDeviceEnumerator)new MMDeviceEnumeratorObj();
  }
  static string NameOf(IMMDevice d) {
    IPropertyStore s; d.OpenPropertyStore(0, out s);
    PropVariant v; s.GetValue(ref NameKey, out v); return v.Str();
  }
  static IAudioEndpointVolume Vol(IMMDevice d) {
    Guid g = typeof(IAudioEndpointVolume).GUID; object o;
    d.Activate(ref g, 23, IntPtr.Zero, out o);   // CLSCTX_ALL
    return (IAudioEndpointVolume)o;
  }

  public static string List(int flow) {
    IMMDeviceCollection col; Enum().EnumAudioEndpoints(flow, 1, out col);  // active only
    int n; col.GetCount(out n);
    string cur = "";
    try { cur = CurrentId(flow); } catch { }
    var sb = new System.Text.StringBuilder("[");
    for (int i = 0; i < n; i++) {
      IMMDevice d; col.Item(i, out d);
      string id; d.GetId(out id);
      if (i > 0) sb.Append(",");
      sb.Append("{\"id\":").Append(Esc(id))
        .Append(",\"name\":").Append(Esc(NameOf(d)))
        .Append(",\"default\":").Append(id == cur ? "true" : "false").Append("}");
    }
    return sb.Append("]").ToString();
  }
  static string Esc(string s) {
    return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
  }
  static string CurrentId(int flow) {
    IMMDevice d; Enum().GetDefaultAudioEndpoint(flow, 0, out d);
    string id; d.GetId(out id); return id;
  }
  public static string Current(int flow) {
    IMMDevice d; Enum().GetDefaultAudioEndpoint(flow, 0, out d);
    string id; d.GetId(out id);
    return "{\"id\":" + Esc(id) + ",\"name\":" + Esc(NameOf(d)) + "}";
  }
  public static void SetDefault(string id, int[] roles) {
    var pc = (IPolicyConfig)new CPolicyConfigClient();
    foreach (int r in roles) pc.SetDefaultEndpoint(id, r);
  }
  public static string Volume(int flow) {
    IMMDevice d; Enum().GetDefaultAudioEndpoint(flow, 0, out d);
    var v = Vol(d); float lvl; bool mute;
    v.GetMasterVolumeLevelScalar(out lvl); v.GetMute(out mute);
    return "{\"percent\":" + ((int)Math.Round(lvl * 100)).ToString()
         + ",\"muted\":" + (mute ? "true" : "false")
         + ",\"device\":" + Esc(NameOf(d)) + "}";
  }
  public static void SetVolume(int flow, int percent) {
    IMMDevice d; Enum().GetDefaultAudioEndpoint(flow, 0, out d);
    Vol(d).SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, percent / 100f)),
                                      Guid.Empty);
  }
  public static void SetMute(int flow, bool mute) {
    IMMDevice d; Enum().GetDefaultAudioEndpoint(flow, 0, out d);
    Vol(d).SetMute(mute, Guid.Empty);
  }

  static IAudioSessionEnumerator Sessions(int flow) {
    IMMDevice d; Enum().GetDefaultAudioEndpoint(flow, 0, out d);
    Guid g = typeof(IAudioSessionManager2).GUID; object o;
    d.Activate(ref g, 23, IntPtr.Zero, out o);
    IAudioSessionEnumerator e; ((IAudioSessionManager2)o).GetSessionEnumerator(out e);
    return e;
  }
  static string ProcName(uint pid) {
    if (pid == 0) return "System sounds";
    try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; }
    catch { return "pid " + pid.ToString(); }   // it exited between calls
  }

  public static string ListSessions(int flow) {
    IAudioSessionEnumerator e = Sessions(flow);
    int n; e.GetCount(out n);
    var sb = new System.Text.StringBuilder("[");
    for (int i = 0; i < n; i++) {
      IAudioSessionControl2 s;
      if (e.GetSession(i, out s) != 0) continue;
      uint pid; s.GetProcessId(out pid);
      string display; s.GetDisplayName(out display);
      var vol = (ISimpleAudioVolume)s;
      float level; bool mute;
      vol.GetMasterVolume(out level); vol.GetMute(out mute);
      if (sb.Length > 1) sb.Append(",");
      sb.Append("{\"pid\":").Append(pid.ToString())
        .Append(",\"name\":").Append(Esc(ProcName(pid)))
        .Append(",\"display_name\":").Append(Esc(display ?? ""))
        .Append(",\"percent\":").Append(((int)Math.Round(level * 100)).ToString())
        .Append(",\"muted\":").Append(mute ? "true" : "false")
        .Append(",\"system_sounds\":").Append(s.IsSystemSoundsSession() == 0 ? "true" : "false")
        .Append("}");
    }
    return sb.Append("]").ToString();
  }

  // Every session belonging to the process, because one program can hold
  // several - a browser opens one per tab that plays audio, and setting only
  // the first leaves the others untouched.
  public static string SetSessionVolume(int flow, uint pid, int percent, int mute) {
    IAudioSessionEnumerator e = Sessions(flow);
    int n; e.GetCount(out n);
    int touched = 0;
    for (int i = 0; i < n; i++) {
      IAudioSessionControl2 s;
      if (e.GetSession(i, out s) != 0) continue;
      uint spid; s.GetProcessId(out spid);
      if (spid != pid) continue;
      var vol = (ISimpleAudioVolume)s;
      Guid ctx = Guid.Empty;
      if (percent >= 0)
        vol.SetMasterVolume(Math.Max(0f, Math.Min(1f, percent / 100f)), ref ctx);
      if (mute >= 0) vol.SetMute(mute == 1, ref ctx);
      touched++;
    }
    return "{\"sessions\":" + touched.ToString() + "}";
  }
}
`;

const WINDOWS = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// Translated from computer-mcp core/windows.py. C# 5: Windows PowerShell's Add-Type compiler is old.
public static class CmdWindows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern int GetWindowTextLengthW(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint to, bool on);
  [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hwnd);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int WS_EX_APPWINDOW = 0x40000;
  const int WS_EX_NOACTIVATE = 0x08000000;
  const uint GW_OWNER = 4;
  const int DWMWA_CLOAKED = 14;
  const uint WM_CLOSE = 0x10;

  static string Text(IntPtr hwnd) {
    int length = GetWindowTextLengthW(hwnd);
    if (length <= 0) return "";
    StringBuilder text = new StringBuilder(length + 1);
    GetWindowTextW(hwnd, text, text.Capacity);
    return text.ToString();
  }

  static string ClassOf(IntPtr hwnd) {
    StringBuilder text = new StringBuilder(256);
    GetClassNameW(hwnd, text, 256);
    return text.ToString();
  }

  // A suspended Store app, or a window on another virtual desktop, still says it is visible.
  static bool Cloaked(IntPtr hwnd) {
    int value;
    return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out value, 4) == 0 && value != 0;
  }

  static uint PidOf(IntPtr hwnd) {
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    return pid;
  }

  // A Store app's frame belongs to ApplicationFrameHost; its CoreWindow child belongs to the app.
  static uint OwningPid(IntPtr hwnd) {
    uint host = PidOf(hwnd);
    if (ClassOf(hwnd) != "ApplicationFrameWindow") return host;
    uint found = host;
    EnumChildWindows(hwnd, delegate (IntPtr child, IntPtr param) {
      if (ClassOf(child) == "Windows.UI.Core.CoreWindow") {
        uint childPid = PidOf(child);
        if (childPid != 0 && childPid != host) { found = childPid; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // The shell's own test for "belongs on the taskbar".
  static bool IsAppWindow(IntPtr hwnd, IntPtr shell) {
    if (hwnd == shell || !IsWindowVisible(hwnd)) return false;
    if (Text(hwnd).Length == 0) return false;
    int ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
    if ((ex & WS_EX_NOACTIVATE) != 0) return false;
    if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return false;
    if (GetWindow(hwnd, GW_OWNER) != IntPtr.Zero && (ex & WS_EX_APPWINDOW) == 0) return false;
    return !Cloaked(hwnd);
  }

  static string Escape(string text) {
    StringBuilder escaped = new StringBuilder(text.Length + 8);
    foreach (char c in text) {
      if (c == '"') escaped.Append("\\\"");
      else if (c == '\\') escaped.Append("\\\\");
      else if (c < 0x20) escaped.Append("\\u").Append(((int)c).ToString("x4"));
      else escaped.Append(c);
    }
    return escaped.ToString();
  }

  // Topmost first: EnumWindows walks the z-order, so the window last looked at leads.
  public static string List() {
    IntPtr shell = GetShellWindow();
    IntPtr foreground = GetForegroundWindow();
    List<string> items = new List<string>();
    Dictionary<uint, string> names = new Dictionary<uint, string>();
    EnumWindows(delegate (IntPtr hwnd, IntPtr param) {
      if (!IsAppWindow(hwnd, shell)) return true;
      uint pid = OwningPid(hwnd);
      string name;
      if (!names.TryGetValue(pid, out name)) {
        try { name = Process.GetProcessById((int)pid).ProcessName; } catch { name = "unknown"; }
        names[pid] = name;
      }
      string state = IsIconic(hwnd) ? "minimized" : IsZoomed(hwnd) ? "maximized" : "normal";
      items.Add("{\"handle\":" + hwnd.ToInt64() + ",\"title\":\"" + Escape(Text(hwnd)) +
        "\",\"program\":\"" + Escape(name) + "\",\"pid\":" + pid + ",\"state\":\"" + state +
        "\",\"foreground\":" + (hwnd == foreground ? "true" : "false") + "}");
      return true;
    }, IntPtr.Zero);
    return "[" + string.Join(",", items) + "]";
  }

  static void Attempt(IntPtr hwnd) {
    IntPtr current = GetForegroundWindow();
    uint me = GetCurrentThreadId();
    uint ignored;
    List<uint> threads = new List<uint>();
    uint target = GetWindowThreadProcessId(hwnd, out ignored);
    uint front = current == IntPtr.Zero ? 0 : GetWindowThreadProcessId(current, out ignored);
    if (target != 0 && target != me) threads.Add(target);
    if (front != 0 && front != me && front != target) threads.Add(front);
    List<uint> attached = new List<uint>();
    foreach (uint thread in threads) if (AttachThreadInput(me, thread, true)) attached.Add(thread);
    try {
      AllowSetForegroundWindow(-1);
      BringWindowToTop(hwnd);
      SetForegroundWindow(hwnd);
      SetActiveWindow(hwnd);
      SetFocus(hwnd);
    } finally {
      foreach (uint thread in attached) AttachThreadInput(me, thread, false);
    }
  }

  // Confirmed by reading the foreground back: SetForegroundWindow "succeeds" by flashing the taskbar.
  public static bool Focus(long handle) {
    IntPtr hwnd = new IntPtr(handle);
    if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
    Attempt(hwnd);
    if (GetForegroundWindow() != hwnd) {
      // A synthesised key-up makes this process count as having received input.
      keybd_event(0x12, 0, 0, UIntPtr.Zero);
      keybd_event(0x12, 0, 2, UIntPtr.Zero);
      Attempt(hwnd);
    }
    return GetForegroundWindow() == hwnd;
  }

  // Asks politely: an app with unsaved work gets to say so, as if its X had been clicked.
  public static void Close(long handle) {
    PostMessageW(new IntPtr(handle), WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
  }

  // SW_MINIMIZE 6, SW_MAXIMIZE 3, SW_RESTORE 9.
  public static void Show(long handle, int cmd) {
    ShowWindow(new IntPtr(handle), cmd);
  }
}
`;

/**
 * External monitors over DDC/CI — the monitor's own brightness, set through the video cable. A
 * laptop's built-in panel has no DDC/CI and is reached through WMI instead (see commands.ts).
 * Measured on the dev machine's monitor: reads 100.
 */
const BRIGHTNESS = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CmdBrightness {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct PhysicalMonitor {
    public IntPtr Handle;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
  }

  delegate bool MonitorProc(IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorProc callback, IntPtr data);
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr monitor, out uint count);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr monitor, uint count, [Out] PhysicalMonitor[] monitors);
  [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint count, PhysicalMonitor[] monitors);
  [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr monitor, out uint min, out uint current, out uint max);
  [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr monitor, uint value);

  static List<PhysicalMonitor[]> Open() {
    List<PhysicalMonitor[]> all = new List<PhysicalMonitor[]>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data) {
      uint count;
      if (!GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, out count) || count == 0) return true;
      PhysicalMonitor[] physical = new PhysicalMonitor[count];
      if (GetPhysicalMonitorsFromHMONITOR(monitor, count, physical)) all.Add(physical);
      return true;
    }, IntPtr.Zero);
    return all;
  }

  static void Close(List<PhysicalMonitor[]> all) {
    foreach (PhysicalMonitor[] physical in all) DestroyPhysicalMonitors((uint)physical.Length, physical);
  }

  // Percent of the first monitor that answers, or -1 when none speaks DDC/CI.
  public static int Get() {
    List<PhysicalMonitor[]> all = Open();
    try {
      foreach (PhysicalMonitor[] physical in all)
        foreach (PhysicalMonitor monitor in physical) {
          uint min, current, max;
          if (GetMonitorBrightness(monitor.Handle, out min, out current, out max) && max > min)
            return (int)Math.Round((current - min) * 100.0 / (max - min));
        }
      return -1;
    } finally { Close(all); }
  }

  // Every monitor that accepts it; returns how many did.
  public static int Set(int percent) {
    List<PhysicalMonitor[]> all = Open();
    int changed = 0;
    try {
      foreach (PhysicalMonitor[] physical in all)
        foreach (PhysicalMonitor monitor in physical) {
          uint min, current, max;
          if (!GetMonitorBrightness(monitor.Handle, out min, out current, out max) || max <= min) continue;
          uint value = (uint)(min + Math.Round((max - min) * Math.Max(0, Math.Min(100, percent)) / 100.0));
          if (SetMonitorBrightness(monitor.Handle, value)) changed++;
        }
      return changed;
    } finally { Close(all); }
  }
}
`;

/**
 * A screenshot of one display — the largest by default, which on a desk with a laptop and a 2K
 * monitor is the monitor. The thread is made per-monitor DPI aware for the capture, or a scaled
 * display reports its scaled size and the picture comes out cropped.
 */
const SCREEN = String.raw`
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class CmdScreen {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor; public RECT Work; public uint Flags; }
  delegate bool MonitorProc(IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

  static long Area(RECT r) { return (long)(r.Right - r.Left) * (r.Bottom - r.Top); }

  // which: "largest", "primary" or "all". Saves a PNG at path; returns its size as "WxH".
  public static string Capture(string which, string path) {
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));   // PER_MONITOR_AWARE_V2
    try {
      List<MONITORINFO> monitors = new List<MONITORINFO>();
      EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr m, IntPtr hdc, IntPtr r, IntPtr d) {
        MONITORINFO info = new MONITORINFO();
        info.Size = Marshal.SizeOf(typeof(MONITORINFO));
        if (GetMonitorInfoW(m, ref info)) monitors.Add(info);
        return true;
      }, IntPtr.Zero);
      if (monitors.Count == 0) throw new Exception("No screen found");
      RECT area = monitors[0].Monitor;
      foreach (MONITORINFO m in monitors) {
        if (which == "all") {
          area.Left = Math.Min(area.Left, m.Monitor.Left); area.Top = Math.Min(area.Top, m.Monitor.Top);
          area.Right = Math.Max(area.Right, m.Monitor.Right); area.Bottom = Math.Max(area.Bottom, m.Monitor.Bottom);
        } else if (which == "primary") {
          if ((m.Flags & 1) != 0) area = m.Monitor;
        } else if (Area(m.Monitor) > Area(area)) area = m.Monitor;
      }
      int width = area.Right - area.Left, height = area.Bottom - area.Top;
      using (Bitmap bitmap = new Bitmap(width, height))
      using (Graphics graphics = Graphics.FromImage(bitmap)) {
        graphics.CopyFromScreen(area.Left, area.Top, 0, 0, new Size(width, height));
        bitmap.Save(path, ImageFormat.Png);
      }
      return width + "x" + height;
    } finally {
      if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
    }
  }
}
`;

/**
 * Native UI Automation (UIA3 — the COM API FlaUI and Windows-MCP use), declared by hand. The .NET
 * `System.Windows.Automation` client was tried first and sees nothing inside WhatsApp, which is
 * WinUI around WebView2: five title-bar buttons. UIA3 sees the whole app.
 *
 * Only the vtable slots up to the last one called are declared, in exact order — a vtable one slot
 * short does not fail, it calls the neighbouring method (see AUDIO's IAudioSessionControl2). Every
 * property is read by id, so IUIAutomationElement needs slots 0–13 only.
 *
 * The tree is walked with each level's properties cached in one call, never entering what is off
 * screen (see Walk): WhatsApp holds ~21,000 elements, and ~360 of them are on screen.
 */
const UIA = String.raw`
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, Guid("352ffba8-0973-437c-a61f-f64cafd81df9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationCondition { }

[ComImport, Guid("b32a92b5-bc25-4078-9c08-d7ee95c48e03"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationCacheRequest {
  void AddProperty(int propertyId);
  void AddPattern(int patternId);
}

[ComImport, Guid("14314595-b4bc-4055-95f2-58f2e42c9855"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationElementArray {
  int get_Length();
  IUIAutomationElement GetElement(int index);
}

[ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationElement {
  void SetFocus();
  void GetRuntimeId();
  void FindFirst();
  void FindAll();
  void FindFirstBuildCache();
  IUIAutomationElementArray FindAllBuildCache(int scope, IUIAutomationCondition condition, IUIAutomationCacheRequest cache);
  void BuildUpdatedCache();
  [return: MarshalAs(UnmanagedType.Struct)] object GetCurrentPropertyValue(int propertyId);
  void GetCurrentPropertyValueEx();
  [return: MarshalAs(UnmanagedType.Struct)] object GetCachedPropertyValue(int propertyId);
  void GetCachedPropertyValueEx();
  void GetCurrentPatternAs();
  void GetCachedPatternAs();
  [return: MarshalAs(UnmanagedType.IUnknown)] object GetCurrentPattern(int patternId);
}

// UIA's POINT, passed by value to ElementFromPoint.
[StructLayout(LayoutKind.Sequential)] public struct UiaPoint { public int X, Y; }

[ComImport, Guid("4042c624-389c-4afc-a630-9df854a541fc"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationTreeWalker {
  IUIAutomationElement GetParentElement(IUIAutomationElement element);
}

[ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomation {
  void CompareElements();
  void CompareRuntimeIds();
  void GetRootElement();
  IUIAutomationElement ElementFromHandle(IntPtr hwnd);
  IUIAutomationElement ElementFromPoint(UiaPoint point);
  IUIAutomationElement GetFocusedElement();
  void GetRootElementBuildCache();
  void ElementFromHandleBuildCache();
  void ElementFromPointBuildCache();
  void GetFocusedElementBuildCache();
  void CreateTreeWalker();
  IUIAutomationTreeWalker get_ControlViewWalker();
  void get_ContentViewWalker();
  void get_RawViewWalker();
  void get_RawViewCondition();
  IUIAutomationCondition get_ControlViewCondition();
  void get_ContentViewCondition();
  IUIAutomationCacheRequest CreateCacheRequest();
  void CreateTrueCondition();
  void CreateFalseCondition();
  IUIAutomationCondition CreatePropertyCondition(int propertyId, [MarshalAs(UnmanagedType.Struct)] object value);
  void CreatePropertyConditionEx();
  IUIAutomationCondition CreateAndCondition(IUIAutomationCondition a, IUIAutomationCondition b);
}

[ComImport, Guid("ff48dba4-60ef-4201-aa87-54103eef594e")] public class CUIAutomation { }

[ComImport, Guid("fb377fbe-8ea6-46d5-9c73-6499642d3059"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationInvokePattern { void Invoke(); }

// The other patterns the assistant's ui tool acts through; each needs only its first slot.
[ComImport, Guid("a8efa66a-0fda-421a-9194-38021f3578ea"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationSelectionItemPattern { void Select(); }
[ComImport, Guid("619be086-1f4e-4ee4-bafa-210128738730"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationExpandCollapsePattern { void Expand(); }
[ComImport, Guid("b488300f-d015-4f19-9c29-bb595e3645ef"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationScrollItemPattern { void ScrollIntoView(); }

// The text of a box that has no Value: Chromium's editable divs (WhatsApp, Gmail, chat inputs in
// web views) give a Text pattern only. Slots before the one used are placeholders, in vtable order.
[ComImport, Guid("32eba289-3583-42c9-9c59-3b6d9a1e9b6a"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationTextPattern {
  void RangeFromPoint(); void RangeFromChild(); void GetSelection(); void GetVisibleRanges();
  IUIAutomationTextRange DocumentRange { get; }
}
[ComImport, Guid("a543cc6a-f4ae-494b-8239-c814481187a8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationTextRange {
  void Clone(); void Compare(); void CompareEndpoints(); void ExpandToEnclosingUnit(); void FindAttribute();
  void FindText(); void GetAttributeValue(); void GetBoundingRectangles(); void GetEnclosingElement();
  [return: MarshalAs(UnmanagedType.BStr)] string GetText(int maxLength);
}

public static class CmdUia {
  const int BoundingRectangle = 30001, ControlType = 30003, Name = 30005, HasKeyboardFocus = 30008,
    IsKeyboardFocusable = 30009, IsEnabled = 30010, IsPassword = 30019, IsOffscreen = 30022,
    IsInvokePatternAvailable = 30031, IsValuePatternAvailable = 30043, Value = 30045, HelpText = 30013;
  const int InvokePattern = 10000;

  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

  internal static readonly Dictionary<int, string> Roles = new Dictionary<int, string> {
    {50000,"Button"},{50002,"CheckBox"},{50003,"ComboBox"},{50004,"Edit"},{50005,"Link"},{50006,"Image"},
    {50007,"ListItem"},{50008,"List"},{50009,"Menu"},{50011,"MenuItem"},{50013,"RadioButton"},{50015,"Slider"},
    {50018,"Tab"},{50019,"TabItem"},{50020,"Text"},{50021,"ToolBar"},{50023,"Tree"},{50024,"TreeItem"},
    {50025,"Custom"},{50026,"Group"},{50028,"DataGrid"},{50029,"Row"},{50030,"Document"},{50031,"SplitButton"},
    {50032,"Window"},{50033,"Pane"},{50034,"Header"},{50035,"HeaderItem"},{50036,"Table"},{50037,"TitleBar"}
  };

  static IUIAutomation uia;
  // The last snapshot's elements; an id is an index into it, valid until the next Read.
  static List<IUIAutomationElement> last = new List<IUIAutomationElement>();

  internal static IUIAutomation Uia() {
    if (uia == null) uia = (IUIAutomation)new CUIAutomation();
    return uia;
  }

  static string Esc(string text) {
    StringBuilder escaped = new StringBuilder(text.Length + 8);
    foreach (char c in text) {
      if (c == '"') escaped.Append("\\\"");
      else if (c == '\\') escaped.Append("\\\\");
      else if (c < 0x20) escaped.Append(' ');
      else escaped.Append(c);
    }
    return escaped.ToString();
  }

  // Depth first, so the order is the window's own, top to bottom — "the second video" depends on
  // it — and never into a subtree that is off screen. A flat FindAll over WhatsApp walked its
  // whole message history, ~21,000 elements, in 2.4 s; this visits ~360 in ~90 ms.
  internal const int MaxVisited = 4000;

  internal static void Walk(IUIAutomationElement parent, IUIAutomationCondition view, IUIAutomationCacheRequest cache,
                   List<IUIAutomationElement> into, ref int visited) {
    IUIAutomationElementArray children = parent.FindAllBuildCache(2, view, cache);   // TreeScope_Children
    int count = children.get_Length();
    for (int i = 0; i < count && visited < MaxVisited; i++) {
      IUIAutomationElement e = children.GetElement(i);
      visited++;
      object offscreen = e.GetCachedPropertyValue(IsOffscreen);
      if (offscreen is bool && (bool)offscreen) continue;
      into.Add(e);
      Walk(e, view, cache, into, ref visited);
    }
  }

  static List<IUIAutomationElement> Find(long handle) {
    IUIAutomation u = Uia();
    IUIAutomationElement window = u.ElementFromHandle(new IntPtr(handle));
    IUIAutomationCacheRequest cache = u.CreateCacheRequest();
    foreach (int id in new int[] { Name, ControlType, IsOffscreen, IsEnabled, IsPassword, IsKeyboardFocusable, IsValuePatternAvailable, Value, HelpText, BoundingRectangle, HasKeyboardFocus })
      cache.AddProperty(id);
    List<IUIAutomationElement> found = new List<IUIAutomationElement>();
    int visited = 0;
    Walk(window, u.get_ControlViewCondition(), cache, found, ref visited);
    return found;
  }

  // {"elements":[{"id","role","name","value"?,"editable","bounds"?,"focused"?}]}, top of the window
  // first. Read per-monitor DPI aware, so bounds are physical pixels on a scaled second screen too.
  public static string Read(long handle) {
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try { return ReadAware(handle); } finally { if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
  }

  static string ReadAware(long handle) {
    List<IUIAutomationElement> all;
    // Chrome has been seen to fail one read with UIA_E_ELEMENTNOTAVAILABLE while its page
    // changes, and succeed straight after.
    try { all = Find(handle); } catch (COMException) { System.Threading.Thread.Sleep(150); all = Find(handle); }
    last.Clear();
    double[] frame = Uia().ElementFromHandle(new IntPtr(handle)).GetCurrentPropertyValue(BoundingRectangle) as double[];
    HashSet<string> seen = new HashSet<string>();
    StringBuilder json = new StringBuilder("{\"elements\":[");
    foreach (IUIAutomationElement e in all) {
      object enabled = e.GetCachedPropertyValue(IsEnabled);
      if (enabled is bool && !(bool)enabled) continue;
      string name = ((e.GetCachedPropertyValue(Name) as string) ?? "").Trim();
      // WhatsApp's search box drops its name once it holds text; its placeholder stays in HelpText.
      if (name.Length == 0) name = ((e.GetCachedPropertyValue(HelpText) as string) ?? "").Trim();
      object typeId = e.GetCachedPropertyValue(ControlType);
      string role;
      if (!(typeId is int) || !Roles.TryGetValue((int)typeId, out role)) role = "Other";
      bool editable = role == "Edit" || role == "ComboBox" ||
        (role == "Document" && e.GetCachedPropertyValue(IsKeyboardFocusable) is bool &&
         (bool)e.GetCachedPropertyValue(IsKeyboardFocusable) && (bool)(e.GetCachedPropertyValue(IsValuePatternAvailable) ?? false));
      if (name.Length == 0 && !editable) continue;
      // WhatsApp exposes each chat row two or three times over; one is enough to act on.
      if (!seen.Add(role + "\u0001" + name)) continue;
      string value = "";
      object password = e.GetCachedPropertyValue(IsPassword);
      if (editable && !(password is bool && (bool)password)) value = (e.GetCachedPropertyValue(Value) as string) ?? "";
      if (name.Length > 200) name = name.Substring(0, 200);
      if (value.Length > 200) value = value.Substring(0, 200);
      if (last.Count > 0) json.Append(',');
      json.Append("{\"id\":").Append(last.Count).Append(",\"role\":\"").Append(role)
        .Append("\",\"name\":\"").Append(Esc(name)).Append('"');
      if (value.Length > 0) json.Append(",\"value\":\"").Append(Esc(value)).Append('"');
      // Where a box sits: once WhatsApp's search box holds text it loses its name and its
      // placeholder both, and "the box at the top" is then all that says it is the search box.
      double[] r = e.GetCachedPropertyValue(BoundingRectangle) as double[];
      if (editable && r != null && frame != null && frame[3] > 0) {
        double middle = (r[1] + r[3] / 2 - frame[1]) / frame[3];
        json.Append(",\"where\":\"").Append(middle < 0.33 ? "top" : middle > 0.67 ? "bottom" : "middle").Append('"');
      }
      if (r != null && r[2] > 0 && r[3] > 0)
        json.Append(",\"bounds\":[").Append((int)r[0]).Append(',').Append((int)r[1]).Append(',')
          .Append((int)(r[0] + r[2])).Append(',').Append((int)(r[1] + r[3])).Append(']');
      object focus = e.GetCachedPropertyValue(HasKeyboardFocus);
      if (focus is bool && (bool)focus) json.Append(",\"focused\":true");
      json.Append(",\"editable\":").Append(editable ? "true" : "false").Append('}');
      last.Add(e);
    }
    return json.Append("]}").ToString();
  }

  // Invoke when the element offers it — a link or button, without moving the mouse. Otherwise a
  // real click in its middle: WhatsApp's chat rows offer nothing else.
  // A UIA pattern by name: "invoke" | "select" | "expand" | "scroll_into_view". Throws, naming
  // the action, when the element does not offer it — the model then clicks instead.
  public static void Act(int id, string action) {
    IUIAutomationElement e = last[id];
    object pattern = e.GetCurrentPattern(action == "invoke" ? 10000 : action == "select" ? 10010 : action == "expand" ? 10005 : 10017);
    if (pattern == null) throw new Exception("This element cannot " + action.Replace('_', ' ') + "; click it instead");
    if (action == "invoke") ((IUIAutomationInvokePattern)pattern).Invoke();
    else if (action == "select") ((IUIAutomationSelectionItemPattern)pattern).Select();
    else if (action == "expand") ((IUIAutomationExpandCollapsePattern)pattern).Expand();
    else ((IUIAutomationScrollItemPattern)pattern).ScrollIntoView();
  }

  public static string Click(int id) {
    IUIAutomationElement e = last[id];
    object invokable = e.GetCurrentPropertyValue(IsInvokePatternAvailable);
    if (invokable is bool && (bool)invokable) {
      try { ((IUIAutomationInvokePattern)e.GetCurrentPattern(InvokePattern)).Invoke(); return "invoked"; } catch (COMException) { }
    }
    MouseClick(e);
    return "clicked";
  }

  // Into a box: focus it, then click it, because a web page's editable div takes the caret only
  // from a click. The text itself is pasted by the caller.
  // What a box holds now, to confirm that typed text actually landed. Null when it cannot say.
  public static string CurrentValue(int id) {
    IUIAutomationElement e = last[id];
    object available = e.GetCurrentPropertyValue(IsValuePatternAvailable);
    if (!(available is bool) || !(bool)available) return null;
    return e.GetCurrentPropertyValue(Value) as string;
  }

  public static void Focus(int id) {
    IUIAutomationElement e = last[id];
    try { e.SetFocus(); } catch (COMException) { }
    MouseClick(e);
  }

  // Per-monitor aware for both reading the rectangle and placing the cursor, so the two agree on a
  // scaled second screen. The cursor goes back where it was.
  static void MouseClick(IUIAutomationElement e) {
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      double[] r = e.GetCurrentPropertyValue(BoundingRectangle) as double[];
      if (r == null || r[2] <= 0 || r[3] <= 0) throw new Exception("That isn't on screen");
      POINT before;
      GetCursorPos(out before);
      SetCursorPos((int)(r[0] + r[2] / 2), (int)(r[1] + r[3] / 2));
      mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
      mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
      System.Threading.Thread.Sleep(80);
      SetCursorPos(before.X, before.Y);
    } finally {
      if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
    }
  }
}

// The assistant's screenshots (capture.ts). In this block, not SCREEN's, because hiding password
// boxes needs the UIA types above, and a type cannot be shared across two Add-Type assemblies.
// Everything runs per-monitor DPI aware, so the monitor, the window rectangles, UIA's bounds and
// CopyFromScreen all speak the same physical pixels on a scaled second screen.
public static class CmdCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor; public RECT Work; public uint Flags; }
  delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
  const int IsOffscreen = 30022, IsPassword = 30019, BoundingRectangle = 30001;
  // Over this, PNG gives way to JPEG: a photo or video frame on screen can make a PNG bigger than a
  // provider accepts per image (Bedrock: 3.75 MB), while a screen of text stays far below it.
  const int MaxPngBytes = 3000000;
  // Windows already walked once (see Hidden), and the margin Chromium gets after that first walk.
  static readonly HashSet<long> Seen = new HashSet<long>();
  const int WakeMs = 200;

  // A window's rectangle in physical pixels, {"x","y","width","height"}: where the classic screen
  // step reads text off the pixels when the window's tree is thin (BlueStacks).
  public static string WindowRect(long handle) {
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));   // PER_MONITOR_AWARE_V2
    try {
      RECT r;
      if (!GetWindowRect(new IntPtr(handle), out r)) throw new Exception("No such window");
      return "{\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"width\":" + (r.Right - r.Left) + ",\"height\":" + (r.Bottom - r.Top) + "}";
    } finally {
      if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
    }
  }

  // 0 = the display under the foreground window, else the one the window is (mostly) on.
  public static string Display(long handle) {
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));   // PER_MONITOR_AWARE_V2
    try {
      IntPtr hwnd = handle != 0 ? new IntPtr(handle) : GetForegroundWindow();
      // NEAREST for a real window; with none in front (desktop focused), the primary display.
      IntPtr monitor = MonitorFromWindow(hwnd, hwnd == IntPtr.Zero ? 1u : 2u);
      MONITORINFO info = new MONITORINFO();
      info.Size = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfoW(monitor, ref info)) throw new Exception("No screen found");
      RECT m = info.Monitor;
      return "{\"x\":" + m.Left + ",\"y\":" + m.Top + ",\"width\":" + (m.Right - m.Left) + ",\"height\":" + (m.Bottom - m.Top) + "}";
    } finally {
      if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
    }
  }

  // The physical area, password boxes blacked out, scaled to outWidth x outHeight.
  // {"data":base64,"mimeType","redacted":n}
  public static string Grab(int left, int top, int width, int height, int outWidth, int outHeight) {
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      RECT area = new RECT { Left = left, Top = top, Right = left + width, Bottom = top + height };
      // Walked before and after the copy, and both sets blacked out: a login box that appeared
      // during the walk (a page still loading) was copied in plain view when only the walk before
      // counted (T9-T13 review, I5). A box on screen at the copy is in at least one of the two.
      List<RECT> hidden = new List<RECT>();
      foreach (RECT r in Hidden(area)) Merge(hidden, r);
      using (Bitmap raw = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
        using (Graphics g = Graphics.FromImage(raw)) {
          g.CopyFromScreen(left, top, 0, 0, new Size(width, height));
          foreach (RECT r in Hidden(area)) Merge(hidden, r);
          // Before scaling, so no blurred edge of a password survives the resize.
          foreach (RECT r in hidden) g.FillRectangle(Brushes.Black, r.Left - left, r.Top - top, r.Right - r.Left, r.Bottom - r.Top);
        }
        if (outWidth == width && outHeight == height) return Encode(raw, hidden.Count);
        using (Bitmap scaled = new Bitmap(outWidth, outHeight, PixelFormat.Format24bppRgb)) {
          using (Graphics g = Graphics.FromImage(scaled))
          using (ImageAttributes edges = new ImageAttributes()) {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            edges.SetWrapMode(WrapMode.TileFlipXY);   // no dark halo along the image's border
            g.DrawImage(raw, new Rectangle(0, 0, outWidth, outHeight), 0, 0, width, height, GraphicsUnit.Pixel, edges);
          }
          return Encode(scaled, hidden.Count);
        }
      }
    } finally {
      if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
    }
  }

  static string Encode(Bitmap image, int redacted) {
    string mime = "image/png";
    byte[] bytes;
    using (MemoryStream png = new MemoryStream()) { image.Save(png, ImageFormat.Png); bytes = png.ToArray(); }
    if (bytes.Length > MaxPngBytes) {
      mime = "image/jpeg";
      ImageCodecInfo jpeg = null;
      foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders()) if (codec.MimeType == mime) jpeg = codec;
      using (EncoderParameters quality = new EncoderParameters(1))
      using (MemoryStream jpg = new MemoryStream()) {
        quality.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
        image.Save(jpg, jpeg, quality);
        bytes = jpg.ToArray();
      }
    }
    return "{\"data\":\"" + Convert.ToBase64String(bytes) + "\",\"mimeType\":\"" + mime + "\",\"redacted\":" + redacted + "}";
  }

  // What must not leave the machine: every on-screen password box (UIA IsPassword) of every
  // window showing in the area. A window whose tree cannot be read twice running is hidden whole —
  // not knowing whether it shows a password is treated as if it does; so is a hung window, whose
  // tree would only time out.
  // The desktop (Progman / WorkerW) is skipped: it never holds a password box, and its tree took
  // 10 s of a 10.6 s screenshot on the dev machine. Every app window together took ~0.5 s.
  // ponytail: covered windows are walked too; skipping them needs to know which windows above are
  // really opaque (a transparent overlay would hide a password from the check, not the picture).
  static List<RECT> Hidden(RECT area) {
    List<IntPtr> windows = new List<IntPtr>();
    StringBuilder cls = new StringBuilder(32);
    EnumWindows(delegate (IntPtr hwnd, IntPtr data) {
      int cloaked;
      RECT r;
      if (IsWindowVisible(hwnd) && !IsIconic(hwnd) && GetWindowRect(hwnd, out r) && Intersects(r, area) &&
          !(DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0)) {   // DWMWA_CLOAKED
        cls.Length = 0;
        GetClassNameW(hwnd, cls, 32);
        string name = cls.ToString();
        if (name != "Progman" && name != "WorkerW") windows.Add(hwnd);
      }
      return true;
    }, IntPtr.Zero);
    IUIAutomation u = CmdUia.Uia();
    IUIAutomationCacheRequest cache = u.CreateCacheRequest();
    foreach (int id in new int[] { IsOffscreen, IsPassword, BoundingRectangle }) cache.AddProperty(id);
    // Chromium (Chrome, Edge, Electron, WebView2) builds its page's tree only once something walks
    // into it: a fresh Chrome's first screenshot showed its password box with nothing found, the
    // second found it. Asking for the window's children alone did not wake it, even 1.5 s later; one
    // full walk did, with no wait at all. So a window seen for the first time is walked once
    // first, all of them before one short wait kept for slower machines.
    bool asked = false;
    foreach (IntPtr hwnd in windows) {
      if (!Seen.Add(hwnd.ToInt64()) || IsHungAppWindow(hwnd)) continue;
      try { int n = 0; CmdUia.Walk(u.ElementFromHandle(hwnd), u.get_ControlViewCondition(), cache, new List<IUIAutomationElement>(), ref n); asked = true; } catch (Exception) { }
    }
    if (asked) System.Threading.Thread.Sleep(WakeMs);
    List<RECT> hidden = new List<RECT>();
    foreach (IntPtr hwnd in windows) {
      List<IUIAutomationElement> found = null;
      if (IsHungAppWindow(hwnd)) {
        RECT whole;
        if (GetWindowRect(hwnd, out whole)) hidden.Add(whole);
        continue;
      }
      for (int attempt = 0; attempt < 2 && found == null; attempt++) {
        try {
          found = new List<IUIAutomationElement>();
          int visited = 0;
          IUIAutomationElement root = u.ElementFromHandle(hwnd);
          CmdUia.Walk(root, u.get_ControlViewCondition(), cache, found, ref visited);
          // The walk stops at MaxVisited without saying so, and a password box past that point
          // was missed (review I5). Then ask UIA for the password boxes themselves: slower, but
          // only on huge trees, and complete.
          if (visited >= CmdUia.MaxVisited) {
            found = new List<IUIAutomationElement>();
            IUIAutomationElementArray boxes = root.FindAllBuildCache(4, u.CreatePropertyCondition(IsPassword, true), cache);   // TreeScope_Descendants
            for (int i = 0; i < boxes.get_Length(); i++) found.Add(boxes.GetElement(i));
          }
        } catch (Exception) {
          found = null;
          if (attempt == 0) System.Threading.Thread.Sleep(150);
        }
      }
      if (found == null) {
        RECT whole;
        if (GetWindowRect(hwnd, out whole)) hidden.Add(whole);
        continue;
      }
      foreach (IUIAutomationElement e in found) {
        object password = e.GetCachedPropertyValue(IsPassword);
        if (!(password is bool) || !(bool)password) continue;
        double[] b = e.GetCachedPropertyValue(BoundingRectangle) as double[];
        if (b == null || b[2] <= 0 || b[3] <= 0) continue;
        hidden.Add(new RECT { Left = (int)Math.Floor(b[0]), Top = (int)Math.Floor(b[1]),
                              Right = (int)Math.Ceiling(b[0] + b[2]), Bottom = (int)Math.Ceiling(b[1] + b[3]) });
      }
    }
    return hidden;
  }

  // The same box seen by both walks, a pixel or two apart while a page settles, is one box: the
  // union covers both places, and the count the model is told stays right.
  static void Merge(List<RECT> into, RECT r) {
    for (int i = 0; i < into.Count; i++) {
      RECT a = into[i];
      if (!Intersects(a, r)) continue;
      into[i] = new RECT { Left = Math.Min(a.Left, r.Left), Top = Math.Min(a.Top, r.Top),
                           Right = Math.Max(a.Right, r.Right), Bottom = Math.Max(a.Bottom, r.Bottom) };
      return;
    }
    into.Add(r);
  }

  static bool Intersects(RECT a, RECT b) {
    return a.Left < b.Right && b.Left < a.Right && a.Top < b.Bottom && b.Top < a.Bottom;
  }

  // The physical area as a PNG file, nothing hidden: for OCR, which stays on this machine.
  public static void SavePng(int left, int top, int width, int height, string path) {
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      using (Bitmap raw = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
        using (Graphics g = Graphics.FromImage(raw)) g.CopyFromScreen(left, top, 0, 0, new Size(width, height));
        raw.Save(path, ImageFormat.Png);
      }
    } finally {
      if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
    }
  }
}

// What the assistant's guard looks at before a pixel action (probe.ts): the element under a
// point with its two nearest ancestors, and the focused element with its window.
public static class CmdProbe {
  const int ControlType = 30003, Name = 30005, HelpText = 30013;
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);

  static string Role(IUIAutomationElement e) {
    object id = e.GetCurrentPropertyValue(ControlType);
    string role;
    return id is int && CmdUia.Roles.TryGetValue((int)id, out role) ? role : "Other";
  }
  static string Prop(IUIAutomationElement e, int id) { return ((e.GetCurrentPropertyValue(id) as string) ?? "").Trim(); }
  static string Node(IUIAutomationElement e) {
    return "{\"role\":\"" + Role(e) + "\",\"name\":\"" + Esc(Prop(e, Name)) + "\"}";
  }
  static string Esc(string text) {
    StringBuilder escaped = new StringBuilder(text.Length + 8);
    foreach (char c in text) {
      if (c == '"') escaped.Append("\\\"");
      else if (c == '\\') escaped.Append("\\\\");
      else if (c < 0x20) escaped.Append(' ');
      else escaped.Append(c);
    }
    return escaped.ToString();
  }

  // [{"role","name"}, …] innermost first; "[]" where nothing answers.
  public static string At(int x, int y) {
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));   // the point is physical
    try {
      IUIAutomation u = CmdUia.Uia();
      UiaPoint point = new UiaPoint { X = x, Y = y };
      IUIAutomationElement e = u.ElementFromPoint(point);
      IUIAutomationTreeWalker walker = u.get_ControlViewWalker();
      List<string> chain = new List<string>();
      for (int i = 0; i < 3 && e != null; i++) {
        chain.Add(Node(e));
        try { e = walker.GetParentElement(e); } catch (COMException) { e = null; }
      }
      return "[" + string.Join(",", chain.ToArray()) + "]";
    } catch (COMException) {
      return "[]";
    } finally {
      if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
    }
  }

  // {"role","name","help","window","program"}, or "null" when nothing has the focus.
  public static string Focused() {
    IUIAutomationElement e;
    try { e = CmdUia.Uia().GetFocusedElement(); } catch (COMException) { return "null"; }
    if (e == null) return "null";
    IntPtr hwnd = GetForegroundWindow();
    StringBuilder title = new StringBuilder(512);
    GetWindowTextW(hwnd, title, 512);
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    string program = "";
    try { program = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { }
    return "{\"role\":\"" + Role(e) + "\",\"name\":\"" + Esc(Prop(e, Name)) + "\",\"help\":\"" + Esc(Prop(e, HelpText)) +
      "\",\"window\":\"" + Esc(title.ToString()) + "\",\"program\":\"" + Esc(program) + "\"}";
  }

  // The focused box's text as a JSON string, for learning from the user's own fixes (field.ts);
  // "null" when nothing with a value has the focus, and always for a password box.
  public static string FocusedText() {
    IUIAutomationElement e;
    try { e = CmdUia.Uia().GetFocusedElement(); } catch (COMException) { return "null"; }
    if (e == null) return "null";
    object password = e.GetCurrentPropertyValue(30019);
    if (password is bool && (bool)password) return "null";
    object hasValue = e.GetCurrentPropertyValue(30043);
    if (!(hasValue is bool) || !(bool)hasValue) return FocusedTextByPattern(e);
    string value = e.GetCurrentPropertyValue(30045) as string;
    return value == null ? "null" : "\"" + Esc(value) + "\"";
  }

  // A box with no Value pattern read through its Text pattern (Chromium's editable divs: WhatsApp,
  // Gmail, web chat inputs). Before this, every dictation into one ended the watch at the first
  // poll, "could not read the field" (Windows hand test, 2026-11-20). Capped: only a box is wanted.
  static string FocusedTextByPattern(IUIAutomationElement e) {
    object hasText = e.GetCurrentPropertyValue(30040);
    if (!(hasText is bool) || !(bool)hasText) return "null";
    try {
      IUIAutomationTextPattern pattern = (IUIAutomationTextPattern)e.GetCurrentPattern(10014);
      string text = pattern.DocumentRange.GetText(20000);
      return text == null ? "null" : "\"" + Esc(text) + "\"";
    } catch (Exception) { return "null"; }
  }
}
`;

/**
 * Windows' own OCR (Windows.Media.Ocr, the engine behind the Snipping Tool's text actions), for
 * the guard on apps with no tree: what label sits under a click. WinRT from Windows PowerShell
 * 5.1: types loaded by their WindowsRuntime name, async calls awaited through AsTask. Languages
 * are the user's profile languages (English always; Hindi when its language pack is installed).
 * Defined once per worker; WinRT loads on the first call. Writes [{"text","box"}] in physical px.
 */
const OCR =
  String.raw`
function global:Invoke-SubxOcr([int]$left, [int]$top, [int]$width, [int]$height) {
  if (-not $global:SubxAwait) {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $global:SubxAsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` +
  "`" +
  String.raw`1' } | Select-Object -First 1
    $global:SubxAwait = { param($op, [Type]$type) $t = $global:SubxAsTask.MakeGenericMethod($type).Invoke($null, @($op)); if (-not $t.Wait(10000)) { throw 'OCR step timed out' }; $t.Result }
    $global:SubxOcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  # No engine is "could not read", never "nothing there": the click guard asks on an error.
  if (-not $global:SubxOcrEngine) { throw 'No Windows OCR engine for the profile languages' }
  $path = Join-Path $env:TEMP ('subx-ocr-' + [guid]::NewGuid() + '.png')
  $stream = $null
  try {
    [CmdCapture]::SavePng($left, $top, $width, $height, $path)
    $file = & $global:SubxAwait ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = & $global:SubxAwait ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = & $global:SubxAwait ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = & $global:SubxAwait ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = & $global:SubxAwait ($global:SubxOcrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines = foreach ($line in $result.Lines) {
      $x0 = ($line.Words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
      $y0 = ($line.Words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
      $x1 = ($line.Words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
      $y1 = ($line.Words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
      @{ text = $line.Text; box = @{ x = [int]($left + $x0); y = [int]($top + $y0); width = [int]($x1 - $x0); height = [int]($y1 - $y0) } }
    }
    ConvertTo-Json -Compress -Depth 4 @($lines)
  } finally {
    # Disposed first: a locked crop could not be deleted and would stay in TEMP unredacted.
    if ($stream) { $stream.Dispose() }
    Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue
  }
}
`;

/** Each block compiled in its own Add-Type, so one failing to build cannot take the others with it. */
/**
 * Classic Bluetooth devices (headphones, speakers) through the Win32 API Windows itself uses, ported
 * from the personal computer-mcp (`core/bluetooth.py`), where every other route was tried and
 * failed: WinRT events cannot be handled from Windows PowerShell, and toggling the PnP node switches
 * the device off instead of connecting it. Connecting a paired device is cycling its services off
 * and on — a plain enable is refused because the service is already marked enabled.
 */
const BLUETOOTH = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class CmdBluetooth {
  [StructLayout(LayoutKind.Sequential)]
  struct FindRadioParams { public int Size; }

  [StructLayout(LayoutKind.Sequential)]
  struct SystemTime { public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Milliseconds; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct DeviceInfo {
    public int Size;
    public ulong Address;
    public uint ClassOfDevice;
    public bool Connected;
    public bool Remembered;
    public bool Authenticated;
    public SystemTime LastSeen;
    public SystemTime LastUsed;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string Name;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct SearchParams {
    public int Size;
    public bool ReturnAuthenticated, ReturnRemembered, ReturnUnknown, ReturnConnected, IssueInquiry;
    public byte TimeoutMultiplier;
    public IntPtr Radio;
  }

  [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstRadio(ref FindRadioParams p, out IntPtr radio);
  [DllImport("bthprops.cpl")] static extern bool BluetoothFindRadioClose(IntPtr find);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstDevice(ref SearchParams p, ref DeviceInfo info);
  [DllImport("bthprops.cpl")] static extern bool BluetoothFindNextDevice(IntPtr find, ref DeviceInfo info);
  [DllImport("bthprops.cpl")] static extern bool BluetoothFindDeviceClose(IntPtr find);
  [DllImport("bthprops.cpl")] static extern uint BluetoothSetServiceState(IntPtr radio, ref DeviceInfo info, ref Guid service, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(IntPtr device, uint code, ref ulong input, uint inputSize, IntPtr output, uint outputSize, out uint returned, IntPtr overlapped);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  // A2DP sink, hands-free, headset: whichever a device implements brings its link up.
  static readonly Guid[] Audio = {
    new Guid("0000110B-0000-1000-8000-00805F9B34FB"),
    new Guid("0000111E-0000-1000-8000-00805F9B34FB"),
    new Guid("00001108-0000-1000-8000-00805F9B34FB"),
  };
  const uint IOCTL_BTH_DISCONNECT_DEVICE = 0x41000C;
  const int ERROR_DEVICE_NOT_CONNECTED = 1167;

  static IntPtr OpenRadio(out IntPtr find) {
    FindRadioParams p = new FindRadioParams { Size = Marshal.SizeOf(typeof(FindRadioParams)) };
    IntPtr radio;
    find = BluetoothFindFirstRadio(ref p, out radio);
    if (find == IntPtr.Zero) throw new Exception("There is no Bluetooth radio, or Bluetooth is off");
    return radio;
  }

  static void CloseRadio(IntPtr find, IntPtr radio) {
    CloseHandle(radio);
    BluetoothFindRadioClose(find);
  }

  static List<DeviceInfo> Known(IntPtr radio) {
    List<DeviceInfo> all = new List<DeviceInfo>();
    SearchParams p = new SearchParams {
      Size = Marshal.SizeOf(typeof(SearchParams)), ReturnAuthenticated = true, ReturnRemembered = true,
      ReturnConnected = true, Radio = radio,
    };
    DeviceInfo info = new DeviceInfo { Size = Marshal.SizeOf(typeof(DeviceInfo)) };
    IntPtr find = BluetoothFindFirstDevice(ref p, ref info);
    if (find == IntPtr.Zero) return all;
    try {
      do {
        all.Add(info);
        info = new DeviceInfo { Size = Marshal.SizeOf(typeof(DeviceInfo)) };
      } while (BluetoothFindNextDevice(find, ref info));
    } finally { BluetoothFindDeviceClose(find); }
    return all;
  }

  static string Quote(string s) {
    StringBuilder b = new StringBuilder("\"");
    foreach (char c in s ?? "") {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < ' ') b.Append(' ');
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  /** Paired and remembered devices: [{"name","address","connected","paired"}]. */
  public static string Devices() {
    IntPtr find; IntPtr radio = OpenRadio(out find);
    try {
      List<string> items = new List<string>();
      foreach (DeviceInfo d in Known(radio))
        items.Add("{\"name\":" + Quote(d.Name) + ",\"address\":\"" + d.Address.ToString("X12") +
          "\",\"connected\":" + (d.Connected ? "true" : "false") + ",\"paired\":" + (d.Authenticated ? "true" : "false") + "}");
      return "[" + string.Join(",", items.ToArray()) + "]";
    } finally { CloseRadio(find, radio); }
  }

  static bool IsConnected(IntPtr radio, ulong address) {
    foreach (DeviceInfo d in Known(radio)) if (d.Address == address) return d.Connected;
    return false;
  }

  /** Brings up a paired device's link. True once the radio reports it connected. */
  public static bool Connect(string hex) {
    ulong address = Convert.ToUInt64(hex, 16);
    IntPtr find; IntPtr radio = OpenRadio(out find);
    try {
      DeviceInfo? found = null;
      foreach (DeviceInfo d in Known(radio)) if (d.Address == address) found = d;
      if (found == null) throw new Exception("That device isn't paired with this computer");
      DeviceInfo info = found.Value;
      if (info.Connected) return true;
      foreach (Guid service in Audio) {
        Guid s = service;
        BluetoothSetServiceState(radio, ref info, ref s, 0);
        uint on = BluetoothSetServiceState(radio, ref info, ref s, 1);
        // The first service that lands brings the whole link up; each cycle costs seconds.
        if (on == 0 && IsConnected(radio, address)) return true;
      }
      for (int i = 0; i < 10; i++) {
        if (IsConnected(radio, address)) return true;
        Thread.Sleep(300);
      }
      return false;
    } finally { CloseRadio(find, radio); }
  }

  /** Drops the link, leaving the pairing in place. */
  public static bool Disconnect(string hex) {
    ulong address = Convert.ToUInt64(hex, 16);
    IntPtr find; IntPtr radio = OpenRadio(out find);
    try {
      uint returned;
      if (DeviceIoControl(radio, IOCTL_BTH_DISCONNECT_DEVICE, ref address, 8, IntPtr.Zero, 0, out returned, IntPtr.Zero)) return true;
      return Marshal.GetLastWin32Error() == ERROR_DEVICE_NOT_CONNECTED;
    } finally { CloseRadio(find, radio); }
  }
}
`;

export const INTEROP = [
  `Add-Type -TypeDefinition @'${AUDIO}'@ -ErrorAction Stop`,
  `Add-Type -TypeDefinition @'${WINDOWS}'@ -ErrorAction Stop`,
  `Add-Type -TypeDefinition @'${BRIGHTNESS}'@ -ErrorAction Stop`,
  `Add-Type -TypeDefinition @'${SCREEN}'@ -ReferencedAssemblies System.Drawing -ErrorAction Stop`,
  `Add-Type -TypeDefinition @'${UIA}'@ -ReferencedAssemblies System.Drawing -ErrorAction Stop`,
  `Add-Type -TypeDefinition @'${BLUETOOTH}'@ -ErrorAction Stop`,
  OCR,
];
