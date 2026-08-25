# agent-console → React Native / Expo — prep notes

**Status:** PARK — research + architecture notes only; no scaffolding done. Owner call to unpark and pick a layout.
**Owner:** raised in conversation while polishing `packages/agent-console`'s web chat UI.
**Related:** `packages/agent-console/README.md`, `docs/handoffs/repo-source-viewer-park.md` (a different, docs-site-scoped parked idea — not this).

## One-sentence idea

A native iOS/Android `agent-console` client built with Expo, sharing the non-UI logic with the existing web client via `last-ts`'s DI patterns, with web staying "somewhat comparable" and native leaning into an iOS-native ("Liquid Glass") look. A Liquid-Glass-style Mac app is a further-out aspiration, explicitly lower priority.

## What's already true of the current code (no work needed here)

`packages/agent-console/src/opencode/` — `client.ts`, `useSessionStream.ts`, `useSessionDetails.ts` — is already plain React hooks + fetch-based SDK calls, with **zero DOM APIs**. This layer is the natural shared core; it doesn't need a refactor to become "reusable," it already is, modulo two real platform seams below.

Everything else (`components/`, `pages/`, `styles.css`, `viewTransition.ts`, `site.tsx`'s `last-ts/Route`+`last-ts/Router` usage) is web-specific and would need a native counterpart, not a port — `View`/`Text`/`StyleSheet` instead of `div`/CSS, a native navigation library instead of `last-ts/History`, no View Transitions API equivalent (RN has its own screen-transition primitives via whichever navigation library is chosen).

## Two real platform seams found (not guessed — grounded in the actual code + current RN ecosystem state)

1. **`client.ts`'s base URL is a web-only trick.** It defaults to the relative path `/opencode`, which only resolves correctly because Vite's dev-server proxy (`vite.config.ts`) forwards it to `127.0.0.1:4096` — same mechanism that fixed the earlier "stuck loading over Tailscale" bug (see git history / README). React Native has no page origin to resolve a relative URL against. A native client needs a real configured base URL — most likely a settings screen persisting it (e.g. `AsyncStorage`/`expo-secure-store`), still pointed at the dev machine over Tailscale for now, since `opencode serve` only binds to loopback and nothing here proxies for native yet.

2. **The OpenCode SDK's streaming isn't `EventSource` — it's `fetch()` + `ReadableStream`, and that matters.** Checked `@opencode-ai/sdk`'s `createSseClient` directly (`dist/gen/core/serverSentEvents.gen.js`): it does `response.body.pipeThrough(new TextDecoderStream()).getReader()`, not the browser `EventSource` global. That's good news — RN has never had `EventSource` natively, so a polyfill for that specific gap isn't needed. But it is NOT automatically safe: RN 0.74+ improved Hermes's `ReadableStream` support, but there's an actively-discussed 2026 gotcha where Hermes's stock global `fetch` still breaks exactly this pattern (`response.body.getReader()`) in some configurations — it's flagged as silently breaking "every cloud LLM SDK" that streams this way. Expo ships its own `expo/fetch` specifically to fix this. **A native client must use `expo/fetch`, not the RN/Hermes global `fetch`, for the OpenCode SDK's `baseUrl`/fetch override** — confirm this hands-on early (a 10-minute spike: point `expo/fetch` at a running `opencode serve` and confirm `event.subscribe()` actually streams) rather than assuming it works, the same way the web client's actual bugs (client-supplied messageID, missing history load, `127.0.0.1` over Tailscale) were all found by testing, not by trusting docs.

## Monorepo integration — researched, looks solid

Expo has shipped real pnpm-workspace monorepo support since SDK 53 (2025), refined in SDK 55: Metro's resolver handles pnpm symlinks natively, EAS Build auto-detects the workspace root from `pnpm-workspace.yaml`. The 2026-recommended stack is pnpm workspaces + Turborepo + Expo SDK 55 + Metro's built-in monorepo support (this repo doesn't have Turborepo — worth deciding whether to adopt it or just add the app as a plain `packages/*` member the way `agent-console` and `last-ts` already are).

Real constraint to plan around: duplicate `react`/`react-native` versions in one monorepo are unsupported and cause runtime errors — would need `pnpm.overrides` in the root `package.json` pinning a single `react` version shared by `agent-console` (web) and the new native package, the same class of constraint `last-ts`'s peer-dependency setup already manages for `react`/`effect`.

## Decisions genuinely left to the owner (not attempted here — multiple valid approaches, real tradeoffs)

- **Where the native app lives**: new `packages/agent-console-native` (sibling to the web one, matching the `last-ts` precedent) vs. splitting a `packages/agent-console-core` (the already-shared `opencode/*` logic) out from both `-web`/`-native` shells vs. something else.
- **Navigation library**: Expo Router (file-based, closer in spirit to how `last-ts`/`RouterBuilder` already works) vs. React Navigation (more mature, more control). Given the whole premise is "use `last-ts`'s DI to switch between native and web," worth checking whether a fourth `Router.Router` engine (a `Native.layer` alongside `Memory`/`History`/`Waku`) is realistic before picking a library that fights that model.
- **Turborepo adoption** — not currently used anywhere in this repo; the 2026-recommended stack assumes it, but it's a real new tool to bring in, not free.

## Suggested first concrete step, when unparked

A throwaway spike, not the real app: `create-expo-app` in a scratch directory (not committed), point `expo/fetch` at a running local `opencode serve`, confirm `client.event.subscribe()` actually streams token-by-token the way it does on web. That single fact (does the SSE-via-fetch pattern really work on-device, not just in theory) should gate the package-layout decision — if it doesn't work cleanly, the native client's live-update story needs a different design (e.g. polling, or a WebSocket transport if opencode exposes one) before anything else is worth deciding.
