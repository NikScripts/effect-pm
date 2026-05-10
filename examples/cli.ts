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
 * - **Control base URL** — derived from `HOME_SERVER_PORT` (must match `examples/example.ts`)
 *
 * ## Prerequisites
 *
 * 1. Start the demo app first: **`pnpm run example`** (starts `ControlService` on the port below).
 * 2. In another shell, run e.g. **`pnpm run cli ls`**.
 *
 * ## Port contract
 *
 * `HOME_SERVER_PORT` is read here and in `example.ts`. If you change one, change both
 * sessions (or export the variable in your shell profile for the session).
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

import { runCli } from "../src/cli";

/** Must match `examples/example.ts` (default **3001**). */
const CONTROL_PORT = Number(process.env.HOME_SERVER_PORT) || 3001;

runCli({
  name: "Effect-PM Demo CLI",
  version: "0.1.0",
  port: CONTROL_PORT,
});
