import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import * as Lookup from "../src/Lookup";

/**
 * Nameless ipc — `Node.unix([serve…])` mints path + Lookup.
 */

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-nameless-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Hyperlink.Tag<Jobs>()("nameless/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

class Emails extends Hyperlink.Tag<Emails>()("nameless/Emails", {
  emails: Hyperlink.effect(Schema.String),
}) {}

const jobsImpl = { jobs: Effect.succeed(11) };
const emailsImpl = { emails: Effect.succeed("ok") };

describe("Node.unix nameless", () => {
  it.effect("mints address-less node + Lookup; Hyperlink.unix(tag) dials", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const serverCtx = yield* Layer.build(
        Node.unix([Hyperlink.serve(Jobs, jobsImpl)]).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const clientCtx = yield* Layer.build(
        Hyperlink.unix(Jobs, { lookupPath, unlink: false }),
      );

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
      const listenNode = Context.get(serverCtx, Node.ListenNode);
      expect(listenNode.key.startsWith("hyperlink-ts/anonymous-node/")).toBe(true);
      expect(typeof listenNode.path).toBe("string");
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("single serve layer (not array) is accepted", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("one");
      const serverCtx = yield* Layer.build(
        Node.unix(Hyperlink.serve(Jobs, jobsImpl)).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const clientCtx = yield* Layer.build(
        Hyperlink.unix(Jobs, { lookupPath, unlink: false }),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("two resources; discoverClients dials both", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("pair");
      const serverCtx = yield* Layer.build(
        Node.unix([
          Hyperlink.serve(Jobs, jobsImpl),
          Hyperlink.serve(Emails, emailsImpl),
        ]).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const clientCtx = yield* Layer.build(
        Hyperlink.discoverClients([Jobs, Emails], {
          lookupPath,
          unlink: false,
        }),
      );

      const pair = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        const emails = yield* Emails;
        return [yield* jobs.jobs, yield* emails.emails] as const;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(pair).toEqual([11, "ok"]);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("discoverClients rest form (default Lookup path)", () =>
    Effect.gen(function* () {
      // Unique default path via env would collide suites — pin via array form above.
      // Rest shape is type-checked here against the same tags.
      const layer = Hyperlink.discoverClients(Jobs, Emails);
      expect(Layer.isLayer(layer)).toBe(true);
    }),
  );
});
