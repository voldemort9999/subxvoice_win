import type { ReactNode } from "react";
import { CharacterStage } from "./effects/CharacterStage";
import { Contours } from "./effects/Contours";

/**
 * The frame for the two screens someone sees before the app proper: sign-in and first-run setup.
 * The left is the launch stage carried on (the person, dimmer, still speaking now and then), so
 * the window goes from launch to sign-in without a cut; the right is the cream paper the app is
 * made of, with its contour lines drifting while it waits.
 */
/** `aside`: words under the stage (setup lists its steps); sign-in leaves the stage to the person. */
export function AuthShell({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full bg-stage">
      <aside className="relative min-w-[300px] flex-1 overflow-hidden text-stage-ink [-webkit-app-region:drag]">
        <div className="absolute inset-0">
          {/* The name in characters under the person, unless words (setup's steps) sit there. */}
          <CharacterStage mode="ambient" named={!aside} />
        </div>
        <div className="relative flex h-full flex-col justify-between">
          <p className="px-9 pt-12 font-display text-[19px] [font-weight:var(--display-weight)] tracking-tight">
            SUBXVoice
          </p>
          {/* Black under the text, so it reads over the characters without hiding the person. */}
          {aside && (
            <div className="bg-gradient-to-t from-stage via-stage/90 to-transparent px-9 pt-16 pb-9">
              {aside}
            </div>
          )}
        </div>
      </aside>
      <main className="scroll-area relative w-[46%] max-w-[560px] min-w-[380px] overflow-y-auto bg-page shadow-[-30px_0_60px_-24px_rgb(0_0_0/60%)]">
        <div className="absolute inset-0">
          <Contours animate peakX={0.85} peakY={0.9} opacity={0.07} />
        </div>
        <div className="relative flex min-h-full items-center justify-center px-10 py-10">
          <div className="animate-arrive w-full max-w-[360px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
