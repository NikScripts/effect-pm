/**
 * Type-level assertions for shared-Spec {@link Hyperlink.Tag}`(wireKey, spec)`.
 */
import { Effect, Schema } from "effect";
import type { HyperlinkTag, SharedTagFactory } from "../src/Hyperlink";
import * as Hyperlink from "../src/Hyperlink";

const counterSpec = {
  bump: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
  label: Hyperlink.effect(Schema.String),
};

const SharedCounter = Hyperlink.Tag("test-d/shared-counter", counterSpec);
const _factory: SharedTagFactory<typeof counterSpec> = SharedCounter;

class Alpha extends SharedCounter<Alpha>()("test-d/SharedAlpha") {}
class Beta extends SharedCounter<Beta>()("test-d/SharedBeta") {}

const _alpha: HyperlinkTag<Alpha, typeof counterSpec> = Alpha;
const _beta: HyperlinkTag<Beta, typeof counterSpec> = Beta;

const _wire: string = SharedCounter.wireKey;
const _kind: string = SharedCounter.kind;

// Ordinary serve / client — no Family / serveFamily surface.
const _serve = Hyperlink.serveRemote(Alpha, {
  bump: ({ by }: { by: number }) => Effect.succeed(by),
  label: Effect.succeed("a"),
});
const _client = Hyperlink.client(Alpha);

// @ts-expect-error shared factory is not a Context tag — mint with Factory<Self>()(key)
const _notATag: HyperlinkTag<unknown, typeof counterSpec> = SharedCounter;
