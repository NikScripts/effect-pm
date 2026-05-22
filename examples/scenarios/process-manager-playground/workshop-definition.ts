/**
 * @module examples/scenarios/process-manager-playground/workshop-definition
 *
 * Workshop group contract: feeder process + job queue. Run via `pnpm run demo:pm -- group-start workshop-group`.
 */

import { Cause, Clock, Data, Duration, Effect, Exit } from "effect";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Endpoint,
  Polling,
  Process,
  ProcessGroup,
  ProcessSchedule,
  QueueResource,
  Transport,
} from "../../../src";
import { utcDateFromMillis } from "../../../src/utcDate";
import { workshopPort } from "./ports";

const workshopTransport = Transport.http(workshopPort);
const workshopEntry = pathToFileURL(
  join(process.cwd(), "examples/scenarios/process-manager-playground/workshop-definition.ts"),
).href;

export class WorkshopJobError extends Data.TaggedError("WorkshopJobError")<{
  readonly jobId: string;
  readonly reason: string;
}> {}

export interface WorkshopJob {
  readonly id: string;
  readonly label: string;
}

/** Processes string jobs; ids ending in `7` fail once so retries show up in logs. */
export class JobQueue extends QueueResource.Service<
  JobQueue,
  WorkshopJob,
  WorkshopJobError
>()("@demo/playground/Workshop/JobQueue", {
  concurrency: 2,
  capacity: 200,
  retries: 1,
  effect: (job, ctx) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(
        `[JobQueue] attempt ${String(ctx.attempts)} · ${job.id} · ${job.label}`,
      );
      yield* Effect.sleep(Duration.millis(400));
      if (job.id.endsWith("7")) {
        return yield* new WorkshopJobError({
          jobId: job.id,
          reason: "simulated flaky worker (id ends with 7)",
        });
      }
      yield* Effect.logInfo(`[JobQueue] done ${job.id}`);
    }),
  onExit: ({ entry, exit }) =>
    Exit.match(exit, {
      onFailure: (cause) =>
        Effect.logWarning(
          `[JobQueue] failed ${entry.item.id}: ${Cause.pretty(cause)}`,
        ),
      onSuccess: () => Effect.void,
    }),
}) {}

/** Every ~6s while armed, enqueues a batch of workshop jobs (start via CLI). */
export class Feeder extends Process.Service<Feeder>()(
  "@demo/playground/Workshop/Feeder",
  Effect.gen(function* () {
    const queue = yield* JobQueue;
    const now = yield* Clock.currentTimeMillis;
    const batch = [0, 1, 2].map((n) => ({
      id: `job-${now + n}`,
      label: `batch@${String(now)}#${String(n)}`,
    }));
    yield* Effect.logInfo(`[Feeder] enqueue ${String(batch.length)} jobs`);
    yield* queue.add(batch);
  }),
  Polling.spaced(Duration.seconds(6)),
  ProcessSchedule.inMemory([
    ProcessSchedule.at(
      "@demo/playground/Workshop/Feeder",
      utcDateFromMillis(0),
    ),
  ]),
) {}

export class WorkshopGroup extends ProcessGroup.Service<WorkshopGroup>()(
  "@demo/playground/WorkshopGroup",
  [Feeder, JobQueue] as const,
  [
    Endpoint.local(workshopTransport, workshopEntry).default,
    Endpoint.production(workshopTransport),
  ],
) {}
