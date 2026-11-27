import type { MicDevice, MicKind } from "@subx/core";

/**
 * The microphones as the Mac's picker lists them, from what Chromium can see on Windows: the dictation
 * records through Web Audio in the pill, so this window's own device list is the one that counts.
 * Windows gives no connection type to a page, so the kind is read from the name the driver gives it.
 */
export function kindOf(label: string): MicKind {
  const name = label.toLowerCase();
  // A phone lent as a microphone: Phone Link, DroidCam, Iriun, WO Mic.
  if (/iphone|phone link|droidcam|iriun|wo mic/.test(name)) return "iphone";
  if (/virtual|vb-audio|voicemeeter|cable output|stereo mix|obs|nvidia broadcast|krisp|loopback/.test(name))
    return "virtual";
  if (/bluetooth|hands-free|handsfree|airpods|buds|\bbt\b/.test(name)) return "bluetooth";
  // Chromium names a USB device with its vendor and product ids, "(03f0:089d)".
  if (/usb|headset|yeti|rode|shure|blue snowball|wired|jack|line in|\([0-9a-f]{4}:[0-9a-f]{4}\)/.test(name))
    return "wired";
  if (/microphone array|internal|built-in|integrated|realtek|intel.*smart sound|amd audio/.test(name))
    return "built-in";
  return "other";
}

/** Chromium names the system default "Default - <its name>" and lists it again under its own id. */
const DEFAULT_ID = "default";

export async function webMicDevices(): Promise<MicDevice[]> {
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const inputs = all.filter((device) => device.kind === "audioinput" && device.deviceId !== "communications");
  const fallback = inputs.find((device) => device.deviceId === DEFAULT_ID);
  return inputs
    .filter((device) => device.deviceId !== DEFAULT_ID)
    .map((device, index) => {
      const label = device.label || `Microphone ${index + 1}`;
      return {
        id: device.deviceId,
        // Shown as Windows names it, without the USB ids Chromium adds (they still tell the kind).
        name: label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, ""),
        kind: kindOf(label),
        isDefault: !!fallback && fallback.groupId === device.groupId,
      };
    });
}

/**
 * The loudness of one microphone about 20 times a second, for the picker's bars; nothing is kept.
 * The microphone is on only until the returned stop is called (the Mac's rule: on while it is open).
 */
export function listenLevel(deviceId: string, onLevel: (level: number) => void): () => void {
  let stopped = false;
  let release = () => {};
  void navigator.mediaDevices
    .getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
    .then((stream) => {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        onLevel(Math.sqrt(sum / samples.length));
      }, 50);
      release = () => {
        clearInterval(timer);
        for (const track of stream.getTracks()) track.stop();
        void context.close();
      };
      if (stopped) release();
    })
    .catch(() => onLevel(0));
  return () => {
    stopped = true;
    release();
  };
}
