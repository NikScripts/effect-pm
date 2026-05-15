import { describe, expect, it } from "@effect/vitest";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Ref, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  ControlService,
  Process,
  ProcessGroup,
  ProcessGroupContractSchema,
  ProcessStore,
  QueueResource,
} from "../src";
import { provideLayer } from "../src/provideLayer.js";

interface Email {
  readonly to: string;
}

const responseBodyJson = Schema.fromJsonString(Schema.Unknown);

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
      Effect.flatMap((text) => Schema.decodeUnknownEffect(responseBodyJson)(text)),
      Effect.orDie,
    );
    return {
      statusCode: response.status,
      body,
    };
  });

describe("ControlService — contract route", () => {
  it.live("serves typed ProcessGroup contracts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()("@test/ControlContractEmail", {
          effect: (_email: Email) => Effect.void,
        }) {}
        class SyncProcess extends Process.Service<SyncProcess>()("@test/ControlContractProcess", {
          effect: Effect.void,
        }) {}
        yield* Effect.gen(function* () {
          const group = yield* ProcessGroup.make("@test/ControlContractGroup", [
            SyncProcess,
            EmailQueue,
          ] as const);

          yield* ControlService.make({
            port: 32123,
            group,
          });

          const response = yield* requestJson(32123, "/contract");
          const contract = yield* Schema.decodeUnknownEffect(
            ProcessGroupContractSchema,
          )(response.body);

          expect(response.statusCode).toBe(200);
          expect(contract).toEqual(group.contract);
        }).pipe(
          provideLayer(EmailQueue.layer),
          provideLayer(ProcessStore.layer),
          provideLayer(NodeHttpClient.layerUndici),
        );
      }),
    ),
  );

  it.live("serves contract-aligned REST routes for typed groups", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runs = yield* Ref.make(0);
        const delivered = yield* Ref.make<ReadonlyArray<string>>([]);

        class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()("@test/RestEmailQueue", {
          effect: (email) =>
            Ref.update(delivered, (emails) => [...emails, email.to]),
          concurrency: 1,
        }) {}
        class SyncProcess extends Process.Service<SyncProcess>()("@test/RestProcess", {
          effect: Ref.update(runs, (count) => count + 1),
        }) {}

        yield* Effect.gen(function* () {
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

          yield* queue.add({ to: "ops@example.com" });
          while ((yield* queue.completed) < 1) {
            yield* Effect.sleep("5 millis");
          }

          const queueStatus = yield* requestJson(
            32128,
            `/queues/${encodeURIComponent(EmailQueue.id)}`,
          );
          expect(queueStatus.statusCode).toBe(200);
          expect(queueStatus.body).toMatchObject({
            success: true,
            type: "queue",
            data: {
              name: EmailQueue.id,
              completed: 1,
            },
          });

          const pause = yield* requestJson(
            32128,
            `/queues/${encodeURIComponent(EmailQueue.id)}/pause`,
            "POST",
          );
          expect(pause.statusCode).toBe(200);
          expect(yield* Ref.get(delivered)).toEqual(["ops@example.com"]);
        }).pipe(
          provideLayer(EmailQueue.layer),
          provideLayer(ProcessStore.layer),
          provideLayer(NodeHttpClient.layerUndici),
        );
      }),
    ),
  );

  it.live("returns 404 for legacy groups without a contract", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const group = yield* ProcessGroup.make({
          queues: [],
          processes: [],
        });

        yield* ControlService.make({
          port: 32124,
          group,
        });

        const response = yield* requestJson(32124, "/contract");

        expect(response.statusCode).toBe(404);
        expect(response.body).toEqual({ error: "Contract not available" });
      }).pipe(
        provideLayer(ProcessStore.layer),
        provideLayer(NodeHttpClient.layerUndici),
      ),
    ),
  );
});
