#!/usr/bin/env node
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { runGroupChildProgram } from "../groupChild.js";

const program = runGroupChildProgram(process.argv).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
);

void Effect.runPromise(program);
