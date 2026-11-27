/**
 * C# that PowerShell compiles once per worker (Add-Type), for the Windows APIs that are COM —
 * awkward from koffi, routine from C#. Dictation needs two: muting the computer's output while it
 * listens (feedback.ts) and reading back the box it typed into (field.ts).
 *
 * AUDIO is copied unchanged from the personal computer-mcp (`core/audio.py`), where it was audited:
 * IAudioEndpointVolume for the system volume, ISimpleAudioVolume per app session, and the
 * undocumented IPolicyConfig that every third-party device switcher uses.
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

/**
 * The text of the box that has the focus, for learning from the user's own fixes (field.ts). UI
 * Automation, with only the interface slots used: earlier slots are placeholders in vtable order.
 * A box with no Value pattern is read through its Text pattern (Chromium's editable divs: WhatsApp,
 * Gmail, web chat inputs), capped, since only a box is wanted. A password box is never read.
 */
const FIELD = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationElement {
  void SetFocus(); void GetRuntimeId(); void FindFirst(); void FindAll(); void FindFirstBuildCache();
  void FindAllBuildCache(); void BuildUpdatedCache();
  [return: MarshalAs(UnmanagedType.Struct)] object GetCurrentPropertyValue(int propertyId);
  void GetCurrentPropertyValueEx(); void GetCachedPropertyValue(); void GetCachedPropertyValueEx();
  void GetCurrentPatternAs(); void GetCachedPatternAs();
  [return: MarshalAs(UnmanagedType.IUnknown)] object GetCurrentPattern(int patternId);
}

[ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomation {
  void CompareElements(); void CompareRuntimeIds(); void GetRootElement(); void ElementFromHandle();
  void ElementFromPoint();
  IUIAutomationElement GetFocusedElement();
}

[ComImport, Guid("ff48dba4-60ef-4201-aa87-54103eef594e")] public class CUIAutomation { }

[ComImport, Guid("32eba289-3583-42c9-9c59-3b6d9a1e9b6a"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationTextPattern {
  void RangeFromPoint(); void RangeFromChild(); IUIAutomationTextRangeArray GetSelection(); void GetVisibleRanges();
  IUIAutomationTextRange DocumentRange { get; }
}

[ComImport, Guid("ce4ae76a-e717-4c98-81ea-47371d028eb6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationTextRangeArray {
  int Length { get; }
  IUIAutomationTextRange GetElement(int index);
}

[ComImport, Guid("a543cc6a-f4ae-494b-8239-c814481187a8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUIAutomationTextRange {
  IUIAutomationTextRange Clone(); void Compare(); void CompareEndpoints(); void ExpandToEnclosingUnit(); void FindAttribute();
  void FindText(); void GetAttributeValue(); void GetBoundingRectangles(); void GetEnclosingElement();
  [return: MarshalAs(UnmanagedType.BStr)] string GetText(int maxLength);
  void Move(); void MoveEndpointByUnit();
  void MoveEndpointByRange(int endpoint, IUIAutomationTextRange range, int targetEndpoint);
}

public static class CmdField {
  const int IsPassword = 30019, IsTextPatternAvailable = 30040, IsValuePatternAvailable = 30043, Value = 30045;
  const int TextPattern = 10014;
  static IUIAutomation uia;

  // The focused box's text as a JSON string; "null" when nothing readable has the focus.
  public static string FocusedText() {
    if (uia == null) uia = (IUIAutomation)new CUIAutomation();
    IUIAutomationElement e;
    try { e = uia.GetFocusedElement(); } catch (COMException) { return "null"; }
    if (e == null || Is(e, IsPassword)) return "null";
    if (Is(e, IsValuePatternAvailable)) {
      string value = e.GetCurrentPropertyValue(Value) as string;
      return value == null ? "null" : Json(value);
    }
    if (!Is(e, IsTextPatternAvailable)) return "null";
    try {
      IUIAutomationTextPattern pattern = (IUIAutomationTextPattern)e.GetCurrentPattern(TextPattern);
      string text = pattern.DocumentRange.GetText(20000);
      return text == null ? "null" : Json(text);
    } catch (Exception) { return "null"; }
  }

  // Where the cursor is in the focused box, in characters from its start; -1 when it cannot be read
  // (no Text pattern, a password box, nothing focused). For a snippet's swap: the undo must move it
  // back by exactly what was pasted (Mac Inserter.replaceLast).
  public static int CaretOffset() {
    if (uia == null) uia = (IUIAutomation)new CUIAutomation();
    IUIAutomationElement e;
    try { e = uia.GetFocusedElement(); } catch (COMException) { return -1; }
    if (e == null || Is(e, IsPassword) || !Is(e, IsTextPatternAvailable)) return -1;
    try {
      IUIAutomationTextPattern pattern = (IUIAutomationTextPattern)e.GetCurrentPattern(TextPattern);
      IUIAutomationTextRangeArray selection = pattern.GetSelection();
      if (selection == null || selection.Length < 1) return -1;
      IUIAutomationTextRange before = pattern.DocumentRange.Clone();
      // The document from its start to the selection's start (End = 1, Start = 0).
      before.MoveEndpointByRange(1, selection.GetElement(0), 0);
      string text = before.GetText(-1);
      return text == null ? -1 : text.Length;
    } catch (Exception) { return -1; }
  }

  // What the focused element is, for the paste (focus.ts decides): JSON, or "null" with nothing
  // focused. Only what kind of thing it is; never its text.
  public static string FocusInfo() {
    if (uia == null) uia = (IUIAutomation)new CUIAutomation();
    IUIAutomationElement e;
    try { e = uia.GetFocusedElement(); } catch (COMException) { return "null"; }
    if (e == null) return "null";
    object type = e.GetCurrentPropertyValue(ControlType);
    return "{\"controlType\":" + (type is int ? ((int)type).ToString() : "0") +
      ",\"className\":" + Json(e.GetCurrentPropertyValue(ClassName) as string ?? "") +
      ",\"framework\":" + Json(e.GetCurrentPropertyValue(FrameworkId) as string ?? "") +
      ",\"value\":" + (Is(e, IsValuePatternAvailable) ? "true" : "false") +
      ",\"readOnly\":" + (Is(e, ValueIsReadOnly) ? "true" : "false") +
      ",\"password\":" + (Is(e, IsPassword) ? "true" : "false") + "}";
  }

  const int ControlType = 30003, ClassName = 30012, FrameworkId = 30024, ValueIsReadOnly = 30046;

  static bool Is(IUIAutomationElement e, int property) {
    object flag = e.GetCurrentPropertyValue(property);
    return flag is bool && (bool)flag;
  }

  static string Json(string text) {
    StringBuilder escaped = new StringBuilder(text.Length + 8);
    escaped.Append('"');
    foreach (char c in text) {
      if (c == '"') escaped.Append("\\\"");
      else if (c == '\\') escaped.Append("\\\\");
      else if (c < 0x20) escaped.Append(' ');
      else escaped.Append(c);
    }
    escaped.Append('"');
    return escaped.ToString();
  }
}
`;

export const INTEROP = [
  `Add-Type -TypeDefinition @'${AUDIO}'@ -ErrorAction Stop`,
  `Add-Type -TypeDefinition @'${FIELD}'@ -ErrorAction Stop`,
];
