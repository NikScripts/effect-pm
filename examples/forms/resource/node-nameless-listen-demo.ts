/**
 * @module examples/forms/resource/node-nameless-listen-demo
 *
 * **One-command proof** — forks nameless serve, then runs the call process.
 * The serve/call forms themselves take **no** Lookup options (defaults only).
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-nameless-listen-demo.ts
 * ```
 */
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, FileSystem } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { defaultIpcPath } from "../../../src/Lookup"

const root = new URL("../../..", import.meta.url).pathname
const serveScript = `${root}/examples/forms/resource/node-nameless-listen-serve.ts`
const callScript = `${root}/examples/forms/resource/node-nameless-listen-call.ts`

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  // Demo hygiene only — clear a stale default Lookup sock. Not part of nameless listen.
  yield* fs.remove(defaultIpcPath, { force: true }).pipe(Effect.ignore)

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const serve = yield* spawner.spawn(
    ChildProcess.make("pnpm", ["exec", "tsx", serveScript], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    }),
  )

  yield* Effect.sleep("2 seconds")

  const call = yield* spawner.spawn(
    ChildProcess.make("pnpm", ["exec", "tsx", callScript], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    }),
  )
  const callCode = yield* call.exitCode
  yield* serve.kill().pipe(Effect.ignore)
  if (callCode !== 0) {
    return yield* Effect.die(
      new Error(`nameless call exited ${String(callCode)}`),
    )
  }
  yield* Effect.logInfo("nameless demo: two runtimes, two resources — ok")
}).pipe(
  Effect.scoped,
  Effect.provide(NodeChildProcessSpawner.layer),
  Effect.provide(NodeServices.layer),
)

NodeRuntime.runMain(program as Effect.Effect<never, unknown, never>)
