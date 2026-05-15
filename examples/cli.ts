#!/usr/bin/env tsx
/**
 * @module examples/cli
 *
 * ## Thin wrapper around the package CLI (`runCli`)
 *
 * This script exists so **`pnpm run cli`** has a stable entry without passing `tsx` paths
 * on the command line. It configures **only**:
 *
 * - **Display metadata** — `name` / `version` shown in `--help`
 * - **Control base URL** — derived from `HOME_SERVER_PORT` (must match the main scenario)
 *
 * ## Prerequisites
 *
 * - Start the demo app first: **`pnpm run example`** (starts `ControlService` on the port below).
 * 2. In another shell, run e.g. **`pnpm run cli ls`**.
 *
 * ## Port contract
 *
 * `HOME_SERVER_PORT` is read here and in `scenarios/full-process-group-with-queues-and-control-cli.ts`.
 *
 * ## What the CLI talks to
 *
 * The implementation lives in **`src/cli.ts`** (`createCli` / `runCli`). It performs
 * HTTP `POST` requests to the **localhost-only** control API exposed by `ProcessGroup.serve`
 * (see **`src/ControlService.ts`**).
 *
 * ## Commands (summary)
 *
 * | Command | Purpose |
 * |---------|---------|
 * | `ls` | List processes and queues |
 * | `status <name>` | Detailed row for one process or queue |
 * | `start [name]` / `stop [name]` / `restart [name]` | Process control (omit name for all) |
 * | `pause <name>` / `resume <name>` / `shutdown <name>` | Queue lifecycle |
 * | `now <name>` | `runImmediately` on a managed process |
 * | `queues` | Queue table |
 *
 * Pass `--help` after the script (per `@effect/cli` conventions) for full usage.
 */

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Effect, Layer, Option } from "effect";
import { runCli } from "../src/cli";
import { provideLayer } from "../src/provideLayer";

const nodePlatform = Layer.mergeAll(
  NodeServices.layer,
  NodeHttpClient.layerNodeHttp,
);

const main = Effect.gen(function* () {
  const raw = yield* Config.string("HOME_SERVER_PORT").pipe(Config.option);
  const port = Option.match(raw, {
    onNone: () => 3001,
    onSome: (s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : 3001;
    },
  });
  yield* runCli({
    name: "Effect-PM Demo CLI",
    version: "0.1.0",
    port,
  });
}).pipe(provideLayer(nodePlatform));

NodeRuntime.runMain(main);
