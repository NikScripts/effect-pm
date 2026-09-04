/**
 * Shared helpers for `Update` / Lookup plan dry-run tests.
 */
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Schedule,
} from "effect";
import * as Directory from "../../src/Directory";
import * as Launcher from "../../src/Launcher";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";

/** WorkPool stamps this; Update contracts read tip via the same symbol. */
export const workPoolItemSchemaSym = Symbol.for(
  "hyperlink-ts/WorkPool/itemSchema",
);

/** Ephemeral Lookup ipc path unique per label + process. */
export const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-update-${label}-${process.pid}-${now}.sock`;
  });

/**
 * Build Lookup server+client, provide `planStatusOff` by default, run `use`.
 */
export const withLookup = <A, E, R>(
  server: Layer.Layer<never, Lookup.LookupUnaddressed>,
  client: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed>,
  use: Effect.Effect<A, E, R>,
  options?: { readonly status?: "on" | "off" },
) =>
  Effect.gen(function* () {
    const serverCtx = yield* Layer.build(server);
    const clientCtx = yield* Layer.build(client);
    const statusLayer =
      options?.status === "on" ? Lookup.planStatusOn : Lookup.planStatusOff;
    return yield* use.pipe(
      Effect.provide(statusLayer),
      Effect.provide(Context.merge(serverCtx, clientCtx)),
    );
  }).pipe(Effect.scoped);

/** Poll until `until` is true. */
export const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

/** Advertise an Ipc Directory row for dry-run plans. */
export const advertiseIpc = (
  nodeKey: string,
  path: string,
  serves: ReadonlyArray<string>,
): Effect.Effect<void, Directory.IncumbentAlive, Directory.Service> =>
  Effect.gen(function* () {
    const dir = yield* Directory.Service;
    yield* dir.advertise(
      new Directory.AdvertiseRequest({
        nodeKey,
        kind: "IpcSocket",
        path,
        serves: [...serves],
      }),
    );
  });

/** Dummy successor that will never be spawned (plan/simulate only). */
export const dummySuccessor = (label: string) => {
  const node = Node.Service()(`update/dummy-${label}`, {
    path: `/tmp/hyperlink-ts-update-dummy-${label}.sock`,
  });
  const process = Launcher.command("true", [], { token: "env" });
  return { node, process } as const;
};
