import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// C2 — listen proves ROut then dispatches to ipcServer / *Server; clientsFor bundles connect.

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

describe("Node.listen + clientsFor (C2)", () => {
  it("listen on IpcSocket serves the catalog; clientsFor dials without repeating connect", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("catalog");
        class Worker extends Node.Tag<Worker, Jobs | Emails>(
          "listen/Worker",
          { path },
        ) {}

        const serverCtx = yield* Layer.build(
          Node.listen(Worker, [
            Resource.serve(Jobs, jobsImpl),
            Resource.serve(Emails, emailsImpl),
          ]),
        );
        const clientCtx = yield* Layer.build(
          Node.clientsFor(Worker, Jobs, Emails),
        );

        const pair = yield* Effect.gen(function* () {
          const jobs = yield* Jobs;
          const emails = yield* Emails;
          return [yield* jobs.jobs, yield* emails.emails] as const;
        }).pipe(
          Effect.provide(Context.merge(serverCtx, clientCtx)),
        );

        expect(pair).toEqual([1, "ok"]);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
    ));
});
