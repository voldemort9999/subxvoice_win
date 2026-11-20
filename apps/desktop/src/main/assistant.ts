// Builds the assistant that Follow My Words runs (plan T15): the model from assistant-model.ts,
// the direct actions (T16), the screen tools on the platform's screen control, the UIA tool, and
// the user's own hands.
import {
  type AssistantTool,
  buildSystemPrompt,
  createAssistant,
  domainTools,
  onScale,
  pointScale,
  resolveModel,
  screenTools,
  uiTool,
} from "@subx/assistant";
import type { Assistant, Platform } from "@subx/core";
import { assistantModels, scriptNote } from "./assistant-model";
import { viaBackend } from "./demo";
import { apiUrl } from "./providers";

export interface AssistantDeps {
  platform: Platform;
  /** The signed-in session; the backend proxy unlocks OpenRouter with it. */
  token(): Promise<string>;
  /** From the dictation key going down until its paste lands: not the user touching the PC. */
  dictationActive(): boolean;
  /** The user's script setting, read per command. */
  script(): "native" | "roman";
}

/** A fresh assistant per command, so a model change in .env applies to the next one. Null where
 * the platform has no screen control. */
export function assistantFactory(deps: AssistantDeps): (() => Assistant) | null {
  const control = deps.platform.screenControl;
  if (!control) return null;
  const watch = control.watch(deps.dictationActive);
  // Haiku goes through the proxy's existing chat path: the live function stays untouched until
  // the backend move (user, 2026-11-18), and pi-ai still sends Claude's cache_control on it.
  // The released app's models through our server's LLM route (subxvoice-api `POST /v1/llm/messages`,
  // Anthropic's shape), on the user's Cognito token; development and the demo call their models
  // directly with their own keys and never use it.
  const route = { messagesBase: `${apiUrl()}/v1/llm` };
  // Today's direct actions (plan T16). Building them is only object construction, so they are
  // ready long before the first command; the actions themselves start PowerShell on first use.
  let domain: AssistantTool[] = [];
  // What is open, for the first message and after each action (run.ts observeState): the window
  // list the classic writer read before closing or arranging windows.
  let openWindows: (() => Promise<string[]>) | undefined;
  void deps.platform.commands
    ?.actions()
    .then((actions) => {
      // A WhatsApp message the user asked to send is sent by Enter in the box it was typed into,
      // after their yes (domain.ts `sending`).
      domain = domainTools(actions, undefined, { send: () => control.input.key("Return") });
      openWindows = actions.find((action) => action.id === "close_windows")?.facts;
    })
    .catch((error) => console.error("assistant: direct actions unavailable", error));

  return () => {
    const models = assistantModels(viaBackend(), process.env);
    const main = resolveModel(models.model, route);
    const fallback = models.fallback !== models.model ? resolveModel(models.fallback, route) : undefined;
    // A model that points on 0–1000 (Celeris, S-024 calibration) gets its points turned into the
    // screenshot's pixels, and the UI tree's bounds in its own grid.
    const scale = pointScale(models.model);
    const size = () => control.capture.frameSize();
    const screen = screenTools({ capture: control.capture, input: control.input, probe: control.probe });
    const toShot = (x: number, y: number): [number, number] => {
      const [sx, sy] = control.capture.toShot(x, y);
      if (!scale) return [sx, sy];
      const [width, height] = size();
      return [(sx * scale) / width, (sy * scale) / height];
    };
    const tools: AssistantTool[] = [
      ...domain,
      ...(scale ? onScale(screen, size, scale) : screen),
      ...(deps.platform.screen ? [uiTool({ driver: deps.platform.screen, toShot })] : []),
    ];
    return createAssistant({
      model: main.model,
      stream: main.stream,
      // Memory, playbooks and recent commands arrive with T17–T18.
      systemPrompt: buildSystemPrompt({
        memory: scriptNote(deps.script()),
        playbookIndex: "",
        recent: [],
        now: new Date().toString(),
      }),
      tools,
      getApiKey: (provider) => (provider === "openrouter" ? deps.token() : undefined),
      watch,
      releaseInput: () => control.input.releaseAll(),
      observeState: async () => (openWindows ? (await openWindows()).join(" ") : ""),
      trace: (line) => console.log(`assistant: tool ${line}`),
      fallback,
      romanOnly: deps.script() === "roman",
    });
  };
}
