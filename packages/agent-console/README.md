# agent-console

Phase 1 chat client for the OpenCode-backed coding agent. No file editing yet —
the `console` agent profile in `opencode.jsonc` denies `edit`/`bash` outright.

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

3. Open the printed Vite URL, create a session, and chat.

If you run the server on a different host/port, copy `.env.example` to `.env`
and adjust `VITE_OPENCODE_HOST`/`VITE_OPENCODE_PORT`.

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

