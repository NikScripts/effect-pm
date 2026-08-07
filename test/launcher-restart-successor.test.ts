/**
 * Launcher.restartSuccessor — plan blocks before spawn; ambient AlreadyUp / plan Layers.
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
import * as Directory from "../src/Directory";
import * as Hyperlink from "../src/Hyperlink";
import * as Launcher from "../src/Launcher";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-restart-${label}-${process.pid}-${now}.sock`;
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

class Jobs extends Hyperlink.Tag<Jobs>()("restart-successor/Jobs", {
  run: Hyperlink.effect(Schema.Number),
  legacy: Hyperlink.effect(Schema.String),
}) {}

const jobsNext: Lookup.PlanUpdateTag = {
  key: "restart-successor/Jobs",
  [Hyperlink.wireKeySym]: "restart-successor/Jobs",
  [Hyperlink.specSym]: {
    run: Hyperlink.effect(Schema.Number),
  },
};

describe("Launcher.restartSuccessor", () => {
  it.effect(
    "UpdateBlocked from plan stops before successor spawn",
    () =>
      Effect.gen(function* () {
        const path = yield* tmpSock("blocked");
        const node = Node.Tag()("lookup/restart-blocked", { path }).pipe(
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
                path: "/tmp/worker-a-restart.sock",
                serves: ["restart-successor/Jobs"],
              }),
            );

            const successor = Node.Tag()("restart/worker-b", {
              url: "http://127.0.0.1:1/rpc",
              kind: "Http",
            });
            const exit = yield* Effect.exit(
              Launcher.restartSuccessor({
                target: "worker-a",
                successor: {
                  node: successor,
                  process: Launcher.command("sleep", ["120"]),
                },
                tags: [jobsNext],
                incumbent: [Jobs],
              }).pipe(Effect.provide(Launcher.layer)),
            );
            expectTaggedFailure(exit, "UpdateBlocked");
          }),
        );
      }),
    { timeout: 15_000 },
  );

  it.effect(
    "AlreadyUpRef adopt is ambient (no per-call alreadyUp)",
    () =>
      Effect.gen(function* () {
        const ambient = yield* Launcher.AlreadyUpRef;
        expect(ambient).toBe("fail");
        const adopted = yield* Launcher.AlreadyUpRef.pipe(
          Effect.provide(Launcher.alreadyUpAdopt),
        );
        expect(adopted).toBe("adopt");
      }),
  );
});
