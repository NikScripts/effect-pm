import { Context, Effect, Schema } from "effect";
import * as Store from "../src/Store";
import { Storage } from "../src/Store";

// Type-level proof: `Store.provideContext` strips the provided `Storage` from every method — the result
// is Storage-free while reads and non-Storage requirements survive subtractively.

class Dep extends Context.Service<Dep, number>()(
  "hyperlink-ts/test/store-provide-context.test-d/Dep",
) {}

const rowSchema = Schema.Struct({ value: Schema.String });

const contract = Store.contract(
  { row: Store.shape(rowSchema) },
  ({ row }) => ({
    write: row.append,
    read: row.read,
    needsDep: () => Effect.map(Dep, (n) => n),
  }),
);

const effects = Store.catchWriteErrors(Store.effects("scope", contract));

const provided = Store.provideContext(effects, Context.make(Storage, {} as never));

// Storage is discharged from write methods.
void ({} as typeof provided.write satisfies (
  row: { readonly value: string },
) => Effect.Effect<void, never, never>);

// Reads without Storage in their requirement channel are unchanged aside from subtractive no-op.
void ({} as typeof provided.read satisfies (
  payload?: { readonly limit?: number },
) => Effect.Effect<ReadonlyArray<{ readonly value: string }>, never, never>);

// --- Soundness: subtractive discharge — uncovered requirements survive on Effect members. ---

const effectsPartial2 = Store.catchWriteErrors(
  Store.effects("scope", contract),
);

const partial2 = Store.provideContext(
  effectsPartial2,
  Context.make(Storage, {} as never),
);

type NeedsDep2Residual = typeof partial2.needsDep extends (
  ...args: never
) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : never;
type Residual2IsExactlyDep = [NeedsDep2Residual] extends [Dep]
  ? [Dep] extends [NeedsDep2Residual]
    ? true
    : false
  : false;
true satisfies Residual2IsExactlyDep;

// `mapEffects` with a type-preserving transform returns the same shape (Out defaults to Effects).
const traced = Store.mapEffects(provided, (e) => Effect.withSpan(e, "store"));
type Provided = typeof provided;
type Traced = typeof traced;
type Same = [Traced] extends [Provided] ? ([Provided] extends [Traced] ? true : false) : false;
true satisfies Same;
