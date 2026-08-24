/**
 * Type-level assertions for shared-Spec {@link Hyperlink.Service}`(wireKey, spec)`.
 */
import { Schema } from "effect";
import { expectTypeOf } from "vitest";
import type { HyperlinkTag, SharedTagFactory } from "../src/Hyperlink";
import * as Hyperlink from "../src/Hyperlink";

const counterSpec = {
  bump: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
  label: Hyperlink.effect(Schema.String),
};

const SharedCounter = Hyperlink.Service("test-d/shared-counter", counterSpec);
expectTypeOf(SharedCounter).toMatchTypeOf<SharedTagFactory<typeof counterSpec>>();

class Alpha extends SharedCounter<Alpha>()("test-d/SharedAlpha") {}
class Beta extends SharedCounter<Beta>()("test-d/SharedBeta") {}

expectTypeOf(Alpha).toMatchTypeOf<HyperlinkTag<Alpha, typeof counterSpec>>();
expectTypeOf(Beta).toMatchTypeOf<HyperlinkTag<Beta, typeof counterSpec>>();
expectTypeOf(SharedCounter.wireKey).toEqualTypeOf<string>();
expectTypeOf(SharedCounter.kind).toEqualTypeOf<string>();
expectTypeOf(Alpha.key).toEqualTypeOf<string>();

// @ts-expect-error shared factory is not a Context tag — mint with Factory<Self>()(key)
const _notATag: HyperlinkTag<unknown, typeof counterSpec> = SharedCounter;
void _notATag;
