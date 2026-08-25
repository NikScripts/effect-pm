# agent-console

Chat client for the OpenCode-backed coding agent, mobile-friendly (works fine
over Tailscale from a phone), with editing enabled — see Phase 2 below.

## Run

1. Start the OpenCode server **from this directory** so it picks up
   `opencode.jsonc`:

   ```sh
   cd packages/agent-console
   opencode serve --port 4096
   ```

2. In another terminal, start the client:

   ```sh
   pnpm -C packages/agent-console dev
   ```

3. Open the printed Vite URL (the `Network:` one works from another device on
   the same Tailscale net — the LAN ones don't, use Tailscale, never plain
   LAN), create a session, and chat.

**Why the client never talks to `127.0.0.1:4096` directly:** the browser
resolves a relative URL against whatever origin it loaded the page from — a
Tailscale IP on a phone, `localhost` on this machine. A hardcoded
`127.0.0.1:4096` in the client would mean "that device itself" on a phone, not
this one, and `opencode serve` only binds to loopback by default anyway. Fix:
`client.ts` uses the relative path `/opencode`, and `vite.config.ts`'s dev
server proxies it to `127.0.0.1:4096` — so only the already-network-reachable
Vite dev server needs exposing, never the agent server itself. Point at a
different opencode instance via `VITE_OPENCODE_BASE_URL` (see `.env.example`)
if you're not using the proxy.

## Verify the no-edit permission is actually enforced

Don't just trust the config — confirm the server rejects an edit attempt,
not just that the client doesn't offer one:

```sh
opencode run --agent console "Create a file named probe.txt with the text hello"
```

Expect `probe.txt` to **not** exist afterward — check the file, not just the
CLI's text. The model may still narrate something like "Wrote file
successfully" (it's describing what it attempted, with no way to know the
tool call was actually blocked); the real signal is the filesystem.

Two real things this surfaced, both already reflected in `opencode.jsonc` —
noted here so they aren't accidentally reverted:

- `permission.edit: "deny"` alone is **not enough**. It doesn't cover the
  `write` tool (new-file creation) — the agent created a file anyway with only
  `edit` denied. `tools: { write: false, edit: false, patch: false, bash:
  false }` is what actually blocks it (confirmed: the model reports it has no
  write/edit/bash tool available at all).
- **Never pass a client-generated `messageID`** into `session.prompt(Async)`.
  Doing so broke the server's turn-completion tracking and sent a session into
  an unbounded loop (36+ steps, never reached `session.idle`, had to be
  aborted manually via `POST /session/{id}/abort`). Let the server assign
  every message ID; read `role` back off `message.updated` events instead of
  trying to know the ID in advance (see `src/opencode/useSessionStream.ts`).
- **`useSessionStream` must load a session's existing history**, not just
  subscribe to new events. `/event` is a live stream going forward only —
  opening a session that already had messages (from the session list, or a
  fresh page load) showed an empty transcript otherwise. Fixed by fetching
  `client.session.messages(...)` on mount and applying it before the live
  subscription starts (so history can't land after, and out of order
  relative to, something sent moments later).

## Phase 2 — editing (shipped)

`edit`/`write`/`patch` are now `"allow"` in `opencode.jsonc` — the agent can
create and modify files. `bash` and `task` (subagent delegation) stay
`"deny"`; only editing was asked for. Tool calls (edits, reads, greps, etc.)
render inline in the transcript — see `ToolCallBubble.tsx` — so an edit shows
its diff/output in the chat, not just the assistant's narration text.

Verified end-to-end (not just typechecked): asked the agent to edit this
README and add a marker line, confirmed the line actually appeared on disk
and the tool call rendered in the transcript on a mobile viewport with no
horizontal overflow.

