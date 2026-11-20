import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { StreamFn } from "./pi";

/**
 * Bedrock's "An unexpected error occurred during processing", throttling and the like pass on
 * their own; the friend's bench lost runs to them that a retry would have kept (plan T14 h).
 */
const TRANSIENT =
  /unexpected error (occurred )?(during|while) processing|throttl|too many requests|service ?unavailable|overloaded|timed? ?out|ECONNRESET|socket hang up|\b50[0234]\b/i;

/** The model the same run continues on when the main one keeps failing (plan T14). */
export interface Fallback {
  model: Model<Api>;
  stream: StreamFn;
}

const failed = (m: AssistantMessage) => m.stopReason === "error";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The model stream with retries and the fallback. Pi takes the finished reply from `result()`
 * (src/pi/agent-loop.ts), so a failed reply is replaced there by a retry's, or the fallback's:
 * three tries in all for a transient error, two for any other, then the fallback with the same
 * messages. A run that switched stays switched. The user is not asked and is not told about models.
 * The master-escalate harness of the friend's bench, taken as a fallback rather than a router.
 */
export function resilientStream(
  primary: StreamFn,
  opts: { fallback?: Fallback; delayMs?: number },
): StreamFn {
  const delay = opts.delayMs ?? 1000;
  let switched = false;
  const call = async (
    stream: StreamFn,
    model: Model<Api>,
    ...rest: Parameters<StreamFn> extends [unknown, ...infer R] ? R : never
  ) => (await stream(model, ...rest)).result();

  return async (model, context, options) => {
    const { fallback } = opts;
    if (switched && fallback) return fallback.stream(fallback.model, context, options);
    const response = await primary(model, context, options);
    const original = response.result.bind(response);
    let settled: Promise<AssistantMessage> | undefined;
    response.result = () => {
      settled ??= (async () => {
        let message = await original();
        const aborted = () => options?.signal?.aborted === true;
        const tries = TRANSIENT.test(message.errorMessage ?? "") ? 3 : 2;
        for (let tried = 1; failed(message) && tried < tries && !aborted(); tried++) {
          await sleep(delay * tried);
          message = await call(primary, model, context, options).catch((error: unknown) => ({
            ...message,
            errorMessage: String(error),
          }));
        }
        if (failed(message) && fallback && !aborted()) {
          switched = true;
          message = await call(fallback.stream, fallback.model, context, options);
        }
        return message;
      })();
      return settled;
    };
    return response;
  };
}
