import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon } from "./icons";

/** Plays the exact audio that was recorded from the microphone. */
/** One recording plays at a time (the Mac app, fbeacae): starting one pauses the one before. */
let playingNow: HTMLAudioElement | null = null;

export function AudioButton({ id }: { id: string }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      if (!audio.current) return;
      audio.current.pause();
      URL.revokeObjectURL(audio.current.src);
    },
    [],
  );

  async function toggle() {
    if (playing) {
      audio.current?.pause();
      return;
    }
    if (!audio.current) {
      const bytes = await window.subx.history.audio(id);
      const element = new Audio(
        URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/wav" })),
      );
      element.onplay = () => setPlaying(true);
      element.onpause = () => setPlaying(false);
      audio.current = element;
    }
    if (playingNow && playingNow !== audio.current) playingNow.pause();
    playingNow = audio.current;
    await audio.current.play();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? "Pause recording" : "Play recording"}
      // Fills with blue while it plays: the one control on the row that is doing something.
      // A filled circle only while it plays; at rest no ring, as a calm list draws it (Mac c6ed4fe).
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${
        playing ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-well hover:text-ink"
      }`}
    >
      {playing ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="ml-0.5 h-3.5 w-3.5" />}
    </button>
  );
}
