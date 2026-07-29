/**
 * Per-HyperService handoff functions (Locked #39) — invoked from {@link Node.shutdown}
 * on the OUTGOING node after drain, before Lookup leave.
 *
 * A handoff is a serve-site function `(from, to, ctx) => Effect<void | HandoffOutcome>`:
 * `from` is the local service handle, `to` is a peer client of the same HyperService (dialed
 * from the Directory, self excluded by dial), and `ctx` exposes the outcome Effects
 * ({@link hyperlinkHandoffContext}). Returning `void` (or `ctx.done`) succeeds; `ctx.retry`
 * re-runs the function (bounded); `ctx.defer` — or any failure / defect — leaves the node up
 * and surfaces {@link HandoffDeferred} to the shutdown caller.
 *
 * @internal
 */
import { Effect, Option, Schema, Scope } from "effect";

/**
 * The result of a handoff function. Tagged (`_tag` PascalCase) so it reads like the rest of the
 * Effect ecosystem's discriminants; the type / API names stay camelCase ({@link HyperlinkHandoffFn},
 * {@link hyperlinkHandoffContext}).
 *
 * - `Done` — work has been handed off (or there was nothing to hand off). Node may leave + shut down.
 * - `Retry` — re-run this HyperService's handoff (bounded); e.g. the peer was busy.
 * - `Defer` — do **not** leave / shut down; keep the node up and surface {@link HandoffDeferred}.
 *
 * @internal
 */
export type HyperlinkHandoffOutcome =
  | { readonly _tag: "Done" }
  | { readonly _tag: "Retry" }
  | { readonly _tag: "Defer" };

/** The `Done` outcome value. @internal */
export const handoffDone: HyperlinkHandoffOutcome = { _tag: "Done" };
/** The `Retry` outcome value. @internal */
export const handoffRetry: HyperlinkHandoffOutcome = { _tag: "Retry" };
/** The `Defer` outcome value. @internal */
export const handoffDefer: HyperlinkHandoffOutcome = { _tag: "Defer" };

/**
 * The context handed to a handoff function as its third argument — outcome Effects that
 * `yield*` to the matching tag. The happy path is `return yield* ctx.done` (or just `return`,
 * which the runner coerces to `Done`).
 *
 * @internal
 */
export interface HyperlinkHandoffContext {
  /** Succeeds with `{ _tag: "Done" }`. */
  readonly done: Effect.Effect<HyperlinkHandoffOutcome>;
  /** Succeeds with `{ _tag: "Retry" }`. */
  readonly retry: Effect.Effect<HyperlinkHandoffOutcome>;
  /** Succeeds with `{ _tag: "Defer" }`. */
  readonly defer: Effect.Effect<HyperlinkHandoffOutcome>;
}

/** The single shared {@link HyperlinkHandoffContext}. @internal */
export const hyperlinkHandoffContext: HyperlinkHandoffContext = {
  done: Effect.succeed(handoffDone),
  retry: Effect.succeed(handoffRetry),
  defer: Effect.succeed(handoffDefer),
};

/**
 * A serve-site handoff function: move this HyperService's work from the local handle `from`
 * to the peer client `to`, returning an outcome (or `void`, coerced to `Done`).
 *
 * `From` / `To` are the **same** service type — `to` is a peer client of the HyperService that
 * `from` serves locally. Requirements / errors are erased at this storage seam (the runner runs it
 * inside the node's shutdown context and treats any failure as {@link handoffDefer}).
 *
 * @internal
 */
export type HyperlinkHandoffFn<From = any, To = any> = (
  from: From,
  to: To,
  ctx: HyperlinkHandoffContext,
) => Effect.Effect<void | HyperlinkHandoffOutcome, any, any>;

/** Why a handoff did not complete — carried on {@link HandoffDeferred}. @internal */
export const handoffDeferralReason = Schema.Literals([
  "defer",
  "no-peer",
  "retry-exhausted",
  "failed",
]);

/**
 * A HyperService's handoff asked to defer (or had no peer / exhausted its retries / failed), so
 * the OUTGOING node did **not** leave membership or shut down — it restored `phase: "running"` and
 * stays up. Surfaced to the {@link Node.shutdown} caller so an orchestrator can retry later.
 *
 * @category errors
 * @internal
 */
export class HandoffDeferred extends Schema.TaggedErrorClass<HandoffDeferred>()(
  "HandoffDeferred",
  {
    serviceKey: Schema.String,
    reason: handoffDeferralReason,
    node: Schema.optionalKey(Schema.String),
  },
) {
  override get message() {
    const node = this.node === undefined ? "" : ` on "${this.node}"`;
    return (
      `Handoff for "${this.serviceKey}"${node} deferred (${this.reason}); ` +
      `the node stayed running and did not leave membership.`
    );
  }
}

/** Default bound for `Retry` re-runs of a single HyperService's handoff. @internal */
export const DEFAULT_HANDOFF_RETRIES = 3;

/** Coerce a handoff return (`void | outcome`) to an outcome; `void`/`null` ⇒ `Done`. */
const coerceOutcome = (
  value: void | HyperlinkHandoffOutcome,
): HyperlinkHandoffOutcome =>
  value === undefined || value === null ? handoffDone : value;

/**
 * Close a handoff fn's returned Effect at the erase seam — the same edge pattern as
 * {@link ./promiseHandle}`.closeEffect`. The handoff runs inside the node's shutdown context and the
 * runner treats ANY failure/defect as a defer (#9), so its own R/E are erased here (kept off the
 * runner's channels) rather than surfacing `any`.
 */
const closeHandoff = (
  value: unknown,
): Effect.Effect<void | HyperlinkHandoffOutcome> =>
  // SAFE: `value` is the Effect a handoff fn returned; the runner catches all causes.
  value as never;

/**
 * Run one served HyperService's handoff function during {@link Node.shutdown}. Dials the peer
 * (`dialPeer`; `None` ⇒ no peer ⇒ defer), runs `handoff(from, to, ctx)`, coerces `void` to `Done`,
 * loops on `Retry` up to `retries`, and fails with {@link HandoffDeferred} on `Defer` / no peer /
 * retry-exhausted / any failure or defect. The peer dial is scoped for the duration of the run.
 *
 * @internal
 */
export const runHandoffFunction = <To>(params: {
  readonly handoff: HyperlinkHandoffFn;
  readonly from: unknown;
  readonly serviceKey: string;
  readonly node?: string;
  readonly dialPeer: Effect.Effect<Option.Option<To>, never, Scope.Scope>;
  readonly retries?: number;
}): Effect.Effect<void, HandoffDeferred> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fail = (
        reason: typeof handoffDeferralReason.Type,
      ): Effect.Effect<never, HandoffDeferred> =>
        new HandoffDeferred({
          serviceKey: params.serviceKey,
          reason,
          ...(params.node !== undefined ? { node: params.node } : {}),
        });

      const peer = yield* params.dialPeer;
      if (Option.isNone(peer)) {
        yield* Effect.logWarning(
          "handoff deferred: no peer to hand off to; keeping node up",
        ).pipe(Effect.annotateLogs({ "handoff.service": params.serviceKey }));
        return yield* fail("no-peer");
      }
      const to = peer.value;

      // View the fn as `unknown`-returning so its `any` channels never surface on the runner.
      const invokeHandoff = (peerClient: To): unknown =>
        (
          params.handoff as (
            from: unknown,
            toClient: unknown,
            ctx: HyperlinkHandoffContext,
          ) => unknown
        )(params.from, peerClient, hyperlinkHandoffContext);

      // `Failed` is a private settle state for a handoff that failed or defected — folded into a
      // `HandoffDeferred(reason: "failed")` so #9 (defect/orDie) restores running like a defer.
      type Settled = HyperlinkHandoffOutcome | { readonly _tag: "Failed" };
      const settle = (
        run: Effect.Effect<void | HyperlinkHandoffOutcome>,
      ): Effect.Effect<Settled> =>
        run.pipe(
          Effect.map(coerceOutcome),
          Effect.catchCause((cause) =>
            Effect.as(
              Effect.logWarning(
                "handoff function failed/defected; deferring shutdown",
              ).pipe(
                Effect.annotateLogs({
                  "handoff.service": params.serviceKey,
                  "handoff.cause": String(cause),
                }),
              ),
              { _tag: "Failed" as const },
            ),
          ),
        );

      const attempt = (
        remaining: number,
      ): Effect.Effect<void, HandoffDeferred> =>
        Effect.flatMap(
          // Call the fn through an `unknown`-returning view, then `closeHandoff` — never feed the
          // fn's `any` channels straight into the runner's typed pipeline (same edge as
          // `promiseHandle`). A genuinely missing service defects and is folded into a defer (#9).
          settle(closeHandoff(invokeHandoff(to))),
          (outcome) => {
            switch (outcome._tag) {
              case "Done":
                return Effect.void;
              case "Retry":
                return remaining <= 0
                  ? fail("retry-exhausted")
                  : Effect.andThen(
                      Effect.logInfo("handoff retrying").pipe(
                        Effect.annotateLogs({
                          "handoff.service": params.serviceKey,
                          "handoff.retriesLeft": remaining,
                        }),
                      ),
                      attempt(remaining - 1),
                    );
              case "Defer":
                return fail("defer");
              case "Failed":
                return fail("failed");
            }
          },
        );

      return yield* attempt(params.retries ?? DEFAULT_HANDOFF_RETRIES);
    }),
  ).pipe(
    Effect.annotateLogs({ "handoff.service": params.serviceKey }),
    Effect.withLogSpan("handoff.run"),
  );
