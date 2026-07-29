/**
 * Type-level lock: node-bound `.pipe(withHandoff)` stays shallow under stock tsc
 * (same PipeableTag rule as {@link Hyperlink.withReadiness}).
 */
import { Schema } from "effect";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

const spec = {
  ping: Hyperlink.effect(Schema.String),
} as const;

class N1 extends Node.Tag<N1>()("handoff-pipe/n1") {}

class Jobs extends Hyperlink.Tag<Jobs>()("handoff-pipe/Jobs", spec, {
  node: N1,
}).pipe(Hyperlink.withHandoff("drainOnly")) {}

class Released extends Hyperlink.Tag<Released>()("handoff-pipe/Released", spec, {
  node: N1,
}).pipe(Hyperlink.withHandoff("workPoolRelease")) {}

const _drain: Hyperlink.HandoffStrategy | undefined = Hyperlink.handoffOf(Jobs);
const _release: Hyperlink.HandoffStrategy | undefined = Hyperlink.handoffOf(Released);

void [_drain, _release, Jobs, Released];
