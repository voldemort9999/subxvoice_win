import type { SessionRecord } from "@subx/core";
import { useCallback, useEffect, useState } from "react";
import type {
  AccountDevice,
  AccountState,
  AppInfo,
  AppSettings,
  DayTotal,
  MicrophoneOption,
  PermissionStatus,
  UpdateState,
  Usage,
  VoiceSettings,
} from "../../../shared/ipc";
import { errorText } from "./errors";

/** All recordings, newest first. `null` while loading. Refreshes when a new one is saved. */
export function useHistory(): SessionRecord[] | null {
  const [records, setRecords] = useState<SessionRecord[] | null>(null);
  useEffect(() => {
    const load = () => void window.subx.history.list().then(setRecords);
    load();
    return window.subx.history.onChanged(load);
  }, []);
  return records;
}

/** The daily totals (words, speaking time, dictations per day), re-read whenever the history changes. */
export function useDayTotals(): Record<string, DayTotal> | null {
  const [days, setDays] = useState<Record<string, DayTotal> | null>(null);
  useEffect(() => {
    const load = () => void window.subx.stats.days().then(setDays);
    load();
    // This Mac's own count changes with its history; the account's with every device's dictations.
    const offHistory = window.subx.history.onChanged(load);
    const offStats = window.subx.stats.onChanged(load);
    return () => {
      offHistory();
      offStats();
    };
  }, []);
  return days;
}

/** Version, current hotkey and engine status. Re-read when settings change (e.g. a new hotkey). */
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    const load = () => void window.subx.app.info().then(setInfo);
    load();
    return window.subx.settings.onChanged(load);
  }, []);
  return info;
}

const PERMISSION_POLL_MS = 1500;

/** Permission states, re-checked while the screen is open so granting one updates right away. */
export function usePermissions(): PermissionStatus[] | null {
  const [statuses, setStatuses] = useState<PermissionStatus[] | null>(null);
  useEffect(() => {
    const refresh = () => void window.subx.permissions.list().then(setStatuses);
    refresh();
    const timer = setInterval(refresh, PERMISSION_POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return statuses;
}

/** User settings, kept in sync with every window. `null` while loading. */
/** Update progress, pushed from the main process as the download runs. */
export function useUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    void window.subx.update.state().then(setState);
    return window.subx.update.onChanged(setState);
  }, []);
  return state;
}

export function useSettings(): [AppSettings | null, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    void window.subx.settings.get().then(setSettings);
    return window.subx.settings.onChanged(setSettings);
  }, []);
  const update = useCallback((patch: Partial<AppSettings>) => {
    void window.subx.settings.set(patch).then(setSettings);
  }, []);
  return [settings, update];
}

/**
 * Microphones the user can choose from. Device labels are only readable once mic permission has
 * been granted, so this re-reads them when the permission changes.
 */
export function useMicrophones(): MicrophoneOption[] {
  const [options, setOptions] = useState<MicrophoneOption[]>([]);
  useEffect(() => {
    const read = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const inputs = devices
        .filter((device) => device.kind === "audioinput" && device.deviceId !== "communications")
        .map((device, index) => ({
          id: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));
      setOptions(inputs);
      // The pill records, but only this window may enumerate devices.
      window.subx.settings.publishMicrophones(inputs);
    };
    void read();
    navigator.mediaDevices.addEventListener("devicechange", read);
    return () => navigator.mediaDevices.removeEventListener("devicechange", read);
  }, []);
  return options;
}

/** Who is signed in. `null` while the main process is still restoring the saved session. */
export function useAccount(): AccountState | null {
  const [state, setState] = useState<AccountState | null>(null);
  useEffect(() => {
    void window.subx.auth.state().then(setState);
    return window.subx.auth.onChanged(setState);
  }, []);
  return state;
}

/**
 * Dictation time left today, for the whole account. The main process keeps it current from each
 * dictation's own answer, and says when it changed; reading it never waits on the network.
 */
export function useUsage(): Usage | null {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    const load = () => void window.subx.auth.usage().then(setUsage);
    load();
    return window.subx.stats.onChanged(load);
  }, []);
  return usage;
}

/** The computers this account uses; asked once, when the account page opens. */
export function useDevices(): AccountDevice[] | null {
  const [devices, setDevices] = useState<AccountDevice[] | null>(null);
  useEffect(() => {
    void window.subx.auth
      .devices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);
  return devices;
}

/**
 * The account's dictation settings on the server. `null` while loading, or when neither the server
 * nor this Mac's copy has them (`problem` then says why).
 */
export function useVoiceSettings(): {
  settings: VoiceSettings | null;
  problem: string | null;
  update: (patch: Partial<VoiceSettings>) => Promise<void>;
} {
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    window.subx.voice
      .settings()
      .then((value) => {
        if (value) setSettings(value);
        else setProblem("Can't load your settings. Check your connection and try again.");
      })
      .catch((error: unknown) => setProblem(errorText(error)));
  }, []);
  const update = async (patch: Partial<VoiceSettings>) => {
    try {
      setSettings(await window.subx.voice.update(patch));
      setProblem(null);
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return { settings, problem, update };
}
