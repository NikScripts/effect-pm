import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// C2 — unix proves ROut then binds ipc; Node.clients bundles connect.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-listen-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Resource.Tag<Jobs>()("listen/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

class Emails extends Resource.Tag<Emails>()("listen/Emails", {
  emails: Resource.effect(Schema.String),
}) {}

const jobsImpl = { jobs: Effect.succeed(1) };
const emailsImpl = { emails: Effect.succeed("ok") };

describe("Node.unix + clients (C2)", () => {
  it.effect("unix serves catalog; clients(node, …tags) dials without repeating connect", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("catalog-rest");
      class Worker extends Node.Tag<Worker, Jobs | Emails>()(
        "listen/WorkerRest",
        { path },
      ) {}

      const serverCtx = yield* Layer.build(
        Node.unix(Worker, [
          Resource.serve(Jobs, jobsImpl),
          Resource.serve(Emails, emailsImpl),
        ]),
      );
      const clientCtx = yield* Layer.build(Node.clients(Worker, Jobs, Emails));

      const pair = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        const emails = yield* Emails;
        return [yield* jobs.jobs, yield* emails.emails] as const;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(pair).toEqual([1, "ok"]);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.effect("clients(node, [tags]) array form", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("catalog-arr");
      class Worker extends Node.Tag<Worker, Jobs | Emails>()(
        "listen/WorkerArr",
        { path },
      ) {}

      const serverCtx = yield* Layer.build(
        Node.unix(Worker, [
          Resource.serve(Jobs, jobsImpl),
          Resource.serve(Emails, emailsImpl),
        ]),
      );
      const clientCtx = yield* Layer.build(
        Node.clients(Worker, [Jobs, Emails]),
      );

      const pair = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        const emails = yield* Emails;
        return [yield* jobs.jobs, yield* emails.emails] as const;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(pair).toEqual([1, "ok"]);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.effect("clients(…tags) when each tag carries the node", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("catalog-bound");
      class Worker extends Node.Tag<Worker, Jobs | Emails>()(
        "listen/WorkerBound",
        { path },
      ) {}

      class BoundJobs extends Resource.Tag<BoundJobs>()("listen/BoundJobs", {
        jobs: Resource.effect(Schema.Number),
      }).pipe(Resource.andNode(Worker)) {}

      class BoundEmails extends Resource.Tag<BoundEmails>()(
        "listen/BoundEmails",
        {
          emails: Resource.effect(Schema.String),
        },
      ).pipe(Resource.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.unix(Worker, [
          Resource.serve(BoundJobs, jobsImpl),
          Resource.serve(BoundEmails, emailsImpl),
        ]),
      );
      const clientCtx = yield* Layer.build(
        Node.clients(BoundJobs, BoundEmails),
      );

      const pair = yield* Effect.gen(function* () {
        const jobs = yield* BoundJobs;
        const emails = yield* BoundEmails;
        return [yield* jobs.jobs, yield* emails.emails] as const;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(pair).toEqual([1, "ok"]);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.effect("clients([tags]) bound array form", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("catalog-bound-arr");
      class Worker extends Node.Tag<Worker, Jobs | Emails>()(
        "listen/WorkerBoundArr",
        { path },
      ) {}

      class BoundJobs extends Resource.Tag<BoundJobs>()(
        "listen/BoundJobsArr",
        {
          jobs: Resource.effect(Schema.Number),
        },
      ).pipe(Resource.andNode(Worker)) {}

      class BoundEmails extends Resource.Tag<BoundEmails>()(
        "listen/BoundEmailsArr",
        {
          emails: Resource.effect(Schema.String),
        },
      ).pipe(Resource.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.unix(Worker, [
          Resource.serve(BoundJobs, jobsImpl),
          Resource.serve(BoundEmails, emailsImpl),
        ]),
      );
      const clientCtx = yield* Layer.build(
        Node.clients([BoundJobs, BoundEmails]),
      );

      const pair = yield* Effect.gen(function* () {
        const jobs = yield* BoundJobs;
        const emails = yield* BoundEmails;
        return [yield* jobs.jobs, yield* emails.emails] as const;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(pair).toEqual([1, "ok"]);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );
});
