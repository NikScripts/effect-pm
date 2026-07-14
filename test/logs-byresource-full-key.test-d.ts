import { describe, expectTypeOf, it } from "vitest";
import type { Effect } from "effect";
import type { LogEntry } from "../src/LogEntry";
import * as Logs from "../src/Logs";

type ByResource = Effect.Effect<ReadonlyArray<LogEntry>>;

declare const tag: Logs.ResourceLogKeySource;

describe("Logs.byResource full key", () => {
  it("accepts scope tag or full key string — not a processId/queueId bag", () => {
    expectTypeOf(Logs.byResource(tag)).toEqualTypeOf<ByResource>();
    expectTypeOf(Logs.byResource("app/Daily")).toEqualTypeOf<ByResource>();

    // @ts-expect-error bag removed — identity is Tag.key / full key only
    const _bagProcess: ByResource = Logs.byResource({ processId: "app/Daily" });
    // @ts-expect-error bag removed
    const _bagQueue: ByResource = Logs.byResource({ queueId: "q" });
  });
});
