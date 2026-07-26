/**
 * Entry for the repo `hyp` CLI.
 *
 *   pnpm hyp --help
 *   pnpm hyp verify
 *   pnpm hyp check markers
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };
import { hyp } from "./command";

const program = Command.run(hyp, { version: packageJson.version }).pipe(
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
