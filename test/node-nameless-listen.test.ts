import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

/**
 * Nameless ipc — `Node.unix([serve…])` mints path + Lookup.
 */

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-nameless-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Resource.Tag<Jobs>()("nameless/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

class Emails extends Resource.Tag<Emails>()("nameless/Emails", {
  emails: Resource.effect(Schema.String),
}) {}

const jobsImpl = { jobs: Effect.succeed(11) };
const emailsImpl = { emails: Effect.succeed("ok") };

describe("Node.unix nameless", () => {
  it.effect("mints address-less node + Lookup; clientLocal dials", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const serverCtx = yield* Layer.build(
        Node.unix([Resource.serve(Jobs, jobsImpl)], {
          lookupPath,
          unlinkLookup: true,
        }),
      );
      const clientCtx = yield* Layer.build(
        Resource.clientLocal(Jobs, { lookupPath, unlink: false }),
      );

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
      const listenNode = Context.get(serverCtx, Node.ListenNode);
      expect(listenNode.key.startsWith("@nikscripts/effect-pm/anonymous-node/")).toBe(true);
      expect(typeof listenNode.path).toBe("string");
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("single serve layer (not array) is accepted", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("one");
      const serverCtx = yield* Layer.build(
        Node.unix(Resource.serve(Jobs, jobsImpl), {
          lookupPath,
          unlinkLookup: true,
        }),
      );
      const clientCtx = yield* Layer.build(
        Resource.clientLocal(Jobs, { lookupPath, unlink: false }),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("two resources; clientLocal dials both", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("pair");
      const serverCtx = yield* Layer.build(
        Node.unix(
          [
            Resource.serve(Jobs, jobsImpl),
            Resource.serve(Emails, emailsImpl),
          ],
          { lookupPath, unlinkLookup: true },
        ),
      );
      const clientCtx = yield* Layer.build(
        Layer.mergeAll(
          Resource.clientLocal(Jobs, { lookupPath, unlink: false }),
          Resource.clientLocal(Emails, { lookupPath, unlink: false }),
        ),
      );

      const pair = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        const emails = yield* Emails;
        return [yield* jobs.jobs, yield* emails.emails] as const;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(pair).toEqual([11, "ok"]);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});
