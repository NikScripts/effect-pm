import { describe, expect, it } from "@effect/vitest";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Layer, Ref, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  ControlService,
  Process,
  ProcessGroup,
  ProcessGroupContractSchema,
  ProcessStore,
  QueueResource,
} from "../src";
import { responseBodyJson } from "../src/internal/json.js";
import { provideLayer } from "../src/provideLayer.js";

interface Email {
  readonly to: string;
}

const requestJson = (
  port: number,
  path: string,
  method = "GET",
): Effect.Effect<{
  readonly statusCode: number;
  readonly body: unknown;
}, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const request = method === "POST"
      ? HttpClientRequest.post(`http://127.0.0.1:${String(port)}${path}`)
      : HttpClientRequest.get(`http://127.0.0.1:${String(port)}${path}`);
    const response = yield* HttpClient.execute(request).pipe(Effect.orDie);
    const body = yield* response.text.pipe(
      Effect.flatMap((text) =>
        Schema.decodeUnknownEffect(responseBodyJson)(text)
      ),
      Effect.orDie,
    );
    return {
      statusCode: response.status,
      body,
    };
  });

describe("ControlService — contract route", () => {
  it.live("serves typed ProcessGroup contracts", () =>
      Effect.gen(function* () {
      class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()("@test/ControlContractEmail", {
        effect: (_email: Email) => Effect.void,
      }) {}
      class SyncProcess extends Process.Service<SyncProcess>()("@test/ControlContractProcess", {
        effect: Effect.void,
      }) {}

      return yield* Effect.gen(function* () {
        const group = yield* ProcessGroup.make("@test/ControlContractGroup", [
          SyncProcess,
          EmailQueue,
        ] as const);

        yield* ControlService.make({
          port: 32123,
          group,
        });

        const response = yield* requestJson(32123, "/contract");
        const contract = yield* Schema.decodeUnknownEffect(ProcessGroupContractSchema)(
          response.body,
        );

        expect(response.statusCode).toBe(200);
        expect(contract).toEqual(group.contract);
      }).pipe(
        provideLayer(
          Layer.mergeAll(
            EmailQueue.layer,
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
      }),
  );

  it.live("serves contract-aligned REST routes for typed groups", () =>
      Effect.gen(function* () {
      const runs = yield* Ref.make(0);
      const delivered = yield* Ref.make<ReadonlyArray<string>>([]);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()("@test/RestEmailQueue", {
        effect: (email) =>
          Ref.update(delivered, (emails) => [...emails, email.to]),
        concurrency: 1,
        paused: true,
      }) {}
      class SyncProcess extends Process.Service<SyncProcess>()("@test/RestProcess", {
        effect: Ref.update(runs, (count) => count + 1),
      }) {}

      return yield* Effect.gen(function* () {
        const group = yield* ProcessGroup.make("@test/RestGroup", [
          SyncProcess,
          EmailQueue,
        ] as const);
        const queue = yield* EmailQueue;

        yield* ControlService.make({
          port: 32128,
          group,
        });

        const status = yield* requestJson(32128, "/status");
        expect(status.statusCode).toBe(200);
        expect(status.body).toMatchObject({ success: true });

        const processes = yield* requestJson(32128, "/processes");
        expect(processes.statusCode).toBe(200);
        expect(processes.body).toMatchObject({ success: true });

        const processRun = yield* requestJson(
          32128,
          `/processes/${encodeURIComponent(SyncProcess.id)}/now`,
          "POST",
        );
        expect(processRun.statusCode).toBe(200);
        expect(yield* Ref.get(runs)).toBe(1);

        yield* queue.add({ to: "clear-me@example.com" });

        const pendingQueueStatus = yield* requestJson(
          32128,
          `/queues/${encodeURIComponent(EmailQueue.id)}`,
        );
        expect(pendingQueueStatus.statusCode).toBe(200);
        expect(pendingQueueStatus.body).toMatchObject({
          success: true,
          type: "queue",
          data: {
            name: EmailQueue.id,
            size: {
              total: 1,
            },
            completed: 0,
          },
        });

        const clear = yield* requestJson(
          32128,
          `/queues/${encodeURIComponent(EmailQueue.id)}/clear`,
          "POST",
        );
        expect(clear.statusCode).toBe(200);
        expect(clear.body).toMatchObject({
          success: true,
          data: {
            cleared: 1,
          },
        });

        yield* queue.add({ to: "ops@example.com" });

        const resume = yield* requestJson(
          32128,
          `/queues/${encodeURIComponent(EmailQueue.id)}/resume`,
          "POST",
        );
        expect(resume.statusCode).toBe(200);
        while ((yield* queue.completed) < 1) {
          yield* Effect.sleep("5 millis");
        }

        const pause = yield* requestJson(
          32128,
          `/queues/${encodeURIComponent(EmailQueue.id)}/pause`,
          "POST",
        );
        expect(pause.statusCode).toBe(200);
        expect(yield* Ref.get(delivered)).toEqual(["ops@example.com"]);

        const missingProcess = yield* requestJson(
          32128,
          `/processes/${encodeURIComponent("@test/MissingProcess")}/start`,
          "POST",
        );
        expect(missingProcess.statusCode).toBe(404);
        expect(missingProcess.body).toMatchObject({
          success: false,
          error: "Process '@test/MissingProcess' not found",
        });

        const missingQueue = yield* requestJson(
          32128,
          `/queues/${encodeURIComponent("@test/MissingQueue")}/clear`,
          "POST",
        );
        expect(missingQueue.statusCode).toBe(404);
        expect(missingQueue.body).toMatchObject({
          success: false,
          error: "Queue '@test/MissingQueue' not found",
        });
      }).pipe(
        provideLayer(
          Layer.mergeAll(
            EmailQueue.layer,
            ProcessStore.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
      }),
  );

});
