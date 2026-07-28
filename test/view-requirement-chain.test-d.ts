
import { expectTypeOf } from "vitest"
import * as View from "../src/ui/View"

const Open = View.Prototype<View.ViewProps, View.WithSize>()()
const Mid = Open.Prototype()({ spec: { kind: "app/queue" } as const })
expectTypeOf<View.IsFulfilled<typeof Mid>>().toEqualTypeOf<false>()
expectTypeOf<View.RequirementOf<typeof Mid>>().toEqualTypeOf<View.WithSize>()

const PropsMid = Open.Prototype<{ readonly dense?: boolean }>()()
expectTypeOf<View.IsFulfilled<typeof PropsMid>>().toEqualTypeOf<false>()

const Both = Open
  .Prototype<{ readonly dense?: boolean }>()({ label: "x" as const })
expectTypeOf<View.IsFulfilled<typeof Both>>().toEqualTypeOf<false>()

const Done = Both.Prototype()({ size: "card" as const })
expectTypeOf<View.IsFulfilled<typeof Done>>().toEqualTypeOf<true>()
expectTypeOf(Done.statics).toEqualTypeOf<{
  readonly size: "card"
  readonly label: "x"
}>()
