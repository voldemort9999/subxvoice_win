/**
 * What the pill asks Chromium for. With `cleanup` on, Chromium's WebRTC processing (noise
 * suppression, echo cancellation, gain) runs on the signal, so a TV or people nearby are not written
 * down with the user — the Windows side of the Mac's voice processing (the server repo's
 * `docs/APP-UPDATES.md`, 2026-11-19). Off is for a voice that ever sounds cut off.
 */
export function micConstraints(deviceId: string, cleanup: boolean): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: cleanup,
    noiseSuppression: cleanup,
    autoGainControl: cleanup,
  };
  // `ideal`, not `exact`: an unplugged device falls back to the system default.
  return { audio: deviceId ? { ...audio, deviceId: { ideal: deviceId } } : audio };
}
