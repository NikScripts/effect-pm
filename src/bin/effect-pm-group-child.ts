#!/usr/bin/env node
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer, ManagedRuntime } from "effect";
import { runGroupChildProgram } from "../groupChild.js";

const platform = Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici);
const runtime = ManagedRuntime.make(platform);

void runtime.runPromise(runGroupChildProgram(process.argv));
