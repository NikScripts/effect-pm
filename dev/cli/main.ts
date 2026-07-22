/**
 * Entry for the repo `hl` CLI.
 *
 *   pnpm hl --help
 *   pnpm hl verify
 *   pnpm hl check markers
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };
import { hl } from "./command";

const program = Command.run(hl, { version: packageJson.version }).pipe(
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
