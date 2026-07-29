/**
 * @module examples/node/nameless-unix-demo
 *
 * Forks serve, then call.
 *
 * ```bash
 * pnpm exec tsx examples/node/nameless-unix-demo.ts
 * ```
 *
 * Docs: `docs/examples/node/nameless-unix-demo.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, FileSystem, Layer } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { defaultIpcPath } from "../../src/Lookup"

const root = new URL("../../..", import.meta.url).pathname

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  yield* fs.remove(defaultIpcPath, { force: true }).pipe(Effect.ignore)

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const serve = yield* spawner.spawn(
    ChildProcess.make(
      "pnpm",
      ["exec", "tsx", `${root}/examples/node/nameless-unix-serve.ts`],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    ),
  )
  yield* Effect.sleep("2 seconds")
  const call = yield* spawner.spawn(
    ChildProcess.make(
      "pnpm",
      ["exec", "tsx", `${root}/examples/node/nameless-unix-call.ts`],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    ),
  )
  const code = yield* call.exitCode
  yield* serve.kill().pipe(Effect.ignore)
  if (code !== 0) {
    return yield* Effect.die(new Error(`call exited ${String(code)}`))
  }
}).pipe(
  Effect.scoped,
  Effect.provide(
    Layer.provideMerge(NodeChildProcessSpawner.layer, NodeServices.layer),
  ),
)

// ---cut-after---
NodeRuntime.runMain(program)
