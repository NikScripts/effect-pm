#!/usr/bin/env tsx
/**
 * @module examples/scenarios/process-manager-playground/cli
 *
 * ProcessManager operator CLI. Run: `pnpm run demo:pm -- groups` (see README in this folder).
 */

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime } from "effect";
import { ProcessManager } from "../../../src";
import { AnalyticsGroup } from "./analytics-definition";
import { WorkshopGroup } from "./workshop-definition";

const nodePlatform = Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerNodeHttp);

const cli = ProcessManager.cli([WorkshopGroup, AnalyticsGroup] as const);

/** Strip a lone `--` from `pnpm run demo:pm -- …`. */
const cliArgv = process.argv
  .slice(2)
  .filter((arg, index, argv) => !(arg === "--" && (index === 0 || argv[index - 1] !== "--")));

const app = cli(cliArgv).pipe(Effect.scoped);

const rt = ManagedRuntime.make(nodePlatform);
NodeRuntime.runMain(
  Effect.promise(() =>
    rt.runPromise(app).finally(() => rt.dispose()),
  ),
);
