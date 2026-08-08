/**
 * Lookup.planUpdate — Directory co-update, Dialers census, Advice fallback, wireRemovals.
 */
import {
  Clock,
  Context,
  Effect,
  Layer,
  Schema,
  type Scope,
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Advice from "../src/Advice";
import * as Dialers from "../src/Dialers";
import * as Directory from "../src/Directory";
import * as Hyperlink from "../src/Hyperlink";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-lookup-plan-${label}-${process.pid}-${now}.sock`;
  });

const withLookup = <A, E>(
  server: Layer.Layer<never, Lookup.LookupUnaddressed>,
  client: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed>,
  use: Effect.Effect<A, E, Lookup.Services | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const serverCtx = yield* Layer.build(server);
    const clientCtx = yield* Layer.build(client);
    return yield* use.pipe(
      Effect.provide(Lookup.planStatusOff),
      Effect.provide(Context.merge(serverCtx, clientCtx)),
    );
  }).pipe(Effect.scoped);

class Jobs extends Hyperlink.Tag<Jobs>()("lookup-plan/Jobs", {
  run: Hyperlink.effect(Schema.Number),
  legacy: Hyperlink.effect(Schema.String),
}) {}

/** Same wire key, fewer methods — structural {@link Lookup.PlanUpdateTag} (Tag() claims once). */
const jobsNext: Lookup.PlanUpdateTag = {
  key: "lookup-plan/Jobs",
  [Hyperlink.wireKeySym]: "lookup-plan/Jobs",
  [Hyperlink.specSym]: {
    run: Hyperlink.effect(Schema.Number),
  },
};

const jobsDeprecatedLegacy: Lookup.PlanUpdateTag = {
  key: "lookup-plan/Jobs",
  [Hyperlink.wireKeySym]: "lookup-plan/Jobs",
  [Hyperlink.specSym]: {
    run: Hyperlink.effect(Schema.Number),
    legacy: Hyperlink.effect(Schema.String).pipe(Hyperlink.deprecated),
  },
};

const isUpdateBlocked = (
  err: { readonly _tag: string },
): err is Lookup.UpdateBlocked => err._tag === "UpdateBlocked";

describe("Lookup.planUpdate", () => {
  it.effect(
    "fails UpdateTargetUnknown when nodeKey is not advertised",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("unknown");
        const node = Node.Tag()("lookup/plan-unknown", { path }).pipe(
          Node.asLookup,
        );
        yield* withLookup(
          Lookup.layerNode(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const exit = yield* Effect.exit(
              Lookup.planUpdate("missing-worker", [Jobs]),
            );
            expectTaggedFailure(exit, "UpdateTargetUnknown");
          }),
        );
      }),
    { timeout: 15_000 },
  );

  it.effect(
    "reports coUpdate peers sharing a served key",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("coupd");
        const node = Node.Tag()("lookup/plan-coupd", { path }).pipe(
          Node.asLookup,
        );
        yield* withLookup(
          Lookup.layerNode(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Directory.Tag;
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a.sock",
                serves: ["lookup-plan/Jobs"],
              }),
            );
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-b",
                kind: "IpcSocket",
                path: "/tmp/worker-b.sock",
                serves: ["lookup-plan/Jobs"],
              }),
            );

            const impact = yield* Lookup.planUpdate("worker-a", [Jobs]);
            expect(impact.target).toBe("worker-a");
            expect(impact.served).toEqual(["lookup-plan/Jobs"]);
            expect(impact.coUpdate).toEqual(["worker-b"]);
            expect(impact.lookupFirst).toBe(false);
            expect(impact.blocked).toBe(false);
          }),
        );
      }),
    { timeout: 15_000 },
  );

  it.effect(
    "Advice prefer → clientsAtRisk fallback when Dialers empty",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("advice");
        const node = Node.Tag()("lookup/plan-advice", { path }).pipe(
          Node.asLookup,
        );
        yield* withLookup(
          Lookup.layerNode(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Directory.Tag;
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a.sock",
                serves: ["lookup-plan/Jobs"],
              }),
            );
            yield* Advice.prefer(Jobs, "worker-a");

            const impact = yield* Lookup.planUpdate("worker-a", [Jobs]);
            expect(impact.clientsAtRisk).toEqual([
              {
                dialerId: "advice:lookup-plan/Jobs",
                serviceKey: "lookup-plan/Jobs",
                target: "worker-a",
              },
            ]);
          }),
        );
      }),
    { timeout: 15_000 },
  );

  it.effect(
    "Dialers.register → clientsAtRisk live census",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("dialers");
        const node = Node.Tag()("lookup/plan-dialers", { path }).pipe(
          Node.asLookup,
        );
        yield* withLookup(
          Lookup.layerNode(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Directory.Tag;
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a.sock",
                serves: ["lookup-plan/Jobs"],
              }),
            );
            // Prefer alone would proxy; live Dialers wins when non-empty.
            yield* Advice.prefer(Jobs, "worker-a");
            const dialerId = yield* Dialers.mintId;
            yield* Dialers.register({
              dialerId,
              serviceKey: Jobs.key,
              target: "worker-a",
            });

            const impact = yield* Lookup.planUpdate("worker-a", [Jobs]);
            expect(impact.clientsAtRisk).toEqual([
              {
                dialerId,
                serviceKey: "lookup-plan/Jobs",
                target: "worker-a",
              },
            ]);
          }),
        );
      }),
    { timeout: 15_000 },
  );

  it.effect(
    "lookupFirst when target serves Directory",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("lookup");
        const node = Node.Tag()("lookup/plan-lookup", { path }).pipe(
          Node.asLookup,
        );
        yield* withLookup(
          Lookup.layerNode(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Directory.Tag;
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "lookup-a",
                kind: "IpcSocket",
                path: "/tmp/lookup-a.sock",
                serves: [
                  "hyperlink-ts/Lookup/Directory",
                  "hyperlink-ts/Lookup/Identity",
                ],
              }),
            );

            const impact = yield* Lookup.planUpdate(
              "lookup-a",
              [Directory.Tag],
            );
            expect(impact.lookupFirst).toBe(true);
          }),
        );
      }),
    { timeout: 15_000 },
  );

  it.effect(
    "wireRemovals block unless force; deprecated is not a removal",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("wire");
        const node = Node.Tag()("lookup/plan-wire", { path }).pipe(
          Node.asLookup,
        );
        yield* withLookup(
          Lookup.layerNode(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Directory.Tag;
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a.sock",
                serves: ["lookup-plan/Jobs"],
              }),
            );

            const blocked = yield* Effect.exit(
              Lookup.planUpdate("worker-a", [jobsNext], {
                incumbent: [Jobs],
              }),
            );
            const err = expectTaggedFailure(blocked, "UpdateBlocked");
            expect(isUpdateBlocked(err)).toBe(true);
            if (isUpdateBlocked(err)) {
              expect(err.impact.wireRemovals[0]?.method).toBe("legacy");
            }

            const forced = yield* Lookup.planUpdate("worker-a", [jobsNext], {
              incumbent: [Jobs],
              force: true,
            });
            expect(forced.blocked).toBe(true);
            expect(forced.wireRemovals).toEqual([
              { serviceKey: "lookup-plan/Jobs", method: "legacy" },
            ]);

            const deprecatedOk = yield* Lookup.planUpdate(
              "worker-a",
              [jobsDeprecatedLegacy],
              { incumbent: [Jobs] },
            );
            expect(deprecatedOk.wireRemovals).toEqual([]);
            expect(deprecatedOk.blocked).toBe(false);
          }),
        );
      }),
    { timeout: 15_000 },
  );
});
