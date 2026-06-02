# Remote terminal + Effect RPC handoff

## Branch

```txt
cursor/remote-terminal-plan-c64a
```

## Current status

This branch is stable and pushed.

It includes:

- command-auth work already merged from `main`;
- `ControlTransportRpc` implementation merged from
  `cursor/control-transport-rpc-c64a`;
- remote terminal planning recipe;
- public terminal session contracts;
- `TerminalRpc` group using `effect/unstable/rpc`;
- React `TerminalSessionPort` type surface;
- package/tsup/root export wiring;
- focused terminal RPC tests;
- changesets for public transport/auth/terminal API work.

## Important Effect package finding

Use Effect v4 RPC from the installed `effect` package:

```ts
import { Rpc, RpcGroup } from "effect/unstable/rpc";
```

Do **not** use npm `@effect/rpc@0.75.1` with this repository's current
`effect@4.0.0-beta.*` line. That standalone package targets Effect 3 runtime
paths and failed at runtime during the spike.

## Verification already run

```txt
pnpm exec vitest run test/terminal-rpc.test.ts
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

All passed after terminal Cut 1.

## Merge recommendation

This branch is stable enough to merge into `main` if you want to land:

- `ControlTransportRpc`;
- terminal public contracts/RPC group;
- terminal planning docs;
- Effect RPC transport migration plan.

However, if you want a smaller review surface, you can merge in this order
instead:

1. `cursor/control-transport-rpc-c64a` first;
2. this branch after, or rebase it on updated `main`.

Because this branch already merged `cursor/control-transport-rpc-c64a`, merging
this branch directly will include both.

## Recommended next implementation branch

Continue terminal work in a new branch from this one:

```txt
cursor/remote-terminal-child-process-c64a
```

Next slice:

```txt
Cut 2 — Effect ChildProcess backend + session lifecycle tests
```

Suggested scope:

```txt
src/internal/terminal/childProcessBackend.ts
src/internal/terminal/sessionRegistry.ts
test/terminal-child-process.test.ts
```

Do not implement dashboard UI in that branch.

## Cut 2 requirements

- Use Effect platform/process APIs only.
- Do not use raw `node:*` APIs when an Effect equivalent exists.
- Backend should implement the existing terminal contracts from `src/Terminal.ts`.
- Use `ChildProcess` from `effect/unstable/process`.
- Use `Stream` for terminal output events.
- Use `Scope` for child process lifecycle cleanup.
- Keep PTY support out of v1; PTY remains a later backend.
- Keep `TerminalRpc` unchanged unless tests reveal a contract issue.

## Cut 2 acceptance checks

- Open a configured command target.
- Stream stdout as `TerminalEvent.Output`.
- Emit `TerminalEvent.Exit`.
- Support stdin when opened with pipe input.
- Close/interrupt the child process on session close.
- Timeout/cleanup path emits a close/exit-like event.
- Tests do not require dashboard code.

Run:

```txt
pnpm exec vitest run test/terminal-child-process.test.ts
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

## Relevant files

```txt
docs/recipes/remote-terminal.md
docs/plans/16-effect-rpc-transport-migration.md
src/ControlTransportRpc.ts
src/Terminal.ts
src/TerminalRpc.ts
src/react/TerminalSessionPort.ts
test/control-transport-rpc.test.ts
test/terminal-rpc.test.ts
```

## Notes for local checkout

```sh
git fetch origin
git checkout cursor/remote-terminal-plan-c64a
pnpm install
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

