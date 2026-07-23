import { describe, expectTypeOf, it } from "vitest";
import type { Effect } from "effect";
import type { LogEntry } from "../src/LogEntry";
import * as Logs from "../src/Logs";

type ByHyperlink = Effect.Effect<ReadonlyArray<LogEntry>>;

declare const tag: Logs.HyperlinkLogKeySource;

describe("Logs.byHyperlink full key", () => {
  it("accepts scope tag or full key string — not a processId/queueId bag", () => {
    expectTypeOf(Logs.byHyperlink(tag)).toEqualTypeOf<ByHyperlink>();
    expectTypeOf(Logs.byHyperlink("app/Daily")).toEqualTypeOf<ByHyperlink>();

    // @ts-expect-error bag removed — identity is Tag.key / full key only
    const _bagDaemon: ByHyperlink = Logs.byHyperlink({ processId: "app/Daily" });
    // @ts-expect-error bag removed
    const _bagQueue: ByHyperlink = Logs.byHyperlink({ queueId: "q" });
  });
});
