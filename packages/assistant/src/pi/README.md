# Vendored Pi agent loop

Source of `@earendil-works/pi-agent-core` **1.5.2** (MIT, see `LICENSE`), recovered from the
published package's source maps (`dist/*.js.map` → `sourcesContent`), because a git clone of
`github.com/earendil-works/pi` does not check out on Windows.

Vendored so the loop can be edited for SUBXVoice's assistant. The provider layer,
`@earendil-works/pi-ai`, is **not** vendored: it is a pinned dependency (1.5.2), edited only if a
task needs it.

Changes from upstream (keep this list current):

1. Relative imports drop the `.ts` extension (this repo's TypeScript config).
2. `agent-loop.ts`: three index reads guarded for `noUncheckedIndexedAccess` (`.at(-1)?.`, `?.`).
3. `agent.ts`: `AgentOptions.getFollowUpMessages` is honoured — asked when the follow-up queue is
   empty and the model would stop. Upstream ignored it (cost a whole bench round in S-019).
4. `proxy.ts` not copied (we do not stream through Pi's proxy server).
