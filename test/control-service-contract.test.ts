import { ProcessStorage } from "../src/ProcessStorage";
import { describe, expect, it } from "@effect/vitest";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Layer, Ref, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  ControlProtocolResponseEnvelopeSchema,
  ControlService,
  makeControlProtocolRequestEnvelope,
  Process,
  ProcessGroup,
  ProcessGroupContractSchema,
    QueueResource,
} from "../src";
import { ProcessManagerLogAnnotationKeys } from "../src/LogContext";
import { ProcessManagerLogRelay, relayOnlyLayer } from "../src/Logs";
import { responseBodyJson } from "../src/internal/json";

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

const requestText = (
  port: number,
  path: string,
): Effect.Effect<{
  readonly statusCode: number;
  readonly body: string;
}, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const request = HttpClientRequest.get(`http://127.0.0.1:${String(port)}${path}`);
    const response = yield* HttpClient.execute(request).pipe(Effect.orDie);
    const body = yield* response.text.pipe(Effect.orDie);
    return {
      statusCode: response.status,
      body,
    };
  });

const postJson = (
  port: number,
  path: string,
  body: unknown,
): Effect.Effect<{
  readonly statusCode: number;
  readonly body: unknown;
}, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(`http://127.0.0.1:${String(port)}${path}`),
      body,
    ).pipe(Effect.orDie);
    const response = yield* HttpClient.execute(request).pipe(Effect.orDie);
    const parsed = yield* response.text.pipe(
      Effect.flatMap((text) =>
        Schema.decodeUnknownEffect(responseBodyJson)(text)
      ),
      Effect.orDie,
    );
    return {
      statusCode: response.status,
      body: parsed,
    };
  });

describe("ControlService — contract route", () => {
  it.live("serves typed ProcessGroup contracts through HTTP layer composition", () =>
    Effect.gen(function* () {
      class EmailQueue extends QueueResource.Service<EmailQueue, Email, void>()("@test/ControlLayerEmail", {
        effect: (_email: Email) => Effect.void,
      }) {}
      class SyncProcess extends Process.Service<SyncProcess>()("@test/ControlLayerProcess", {
        effect: Effect.void,
      }) {}
      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/ControlLayerGroup",
        [SyncProcess, EmailQueue] as const,
      ) {}

      const response = yield* requestJson(32129, "/contract").pipe(
        Effect.provide(
          Layer.mergeAll(
            ControlService.layerHttp(BillingGroup, { port: 32129 }).pipe(
              Layer.provide(
                BillingGroup.layer.pipe(
                  Layer.provide(
                    Layer.mergeAll(
                      SyncProcess.layer,
                      EmailQueue.layer,
                      ProcessStorage.layer,
                    ),
                  ),
                ),
              ),
              Layer.provide(ProcessStorage.layer),
            ),
            NodeHttpClient.layerUndici,
          ),
        ),
      );
      const contract = yield* Schema.decodeUnknownEffect(ProcessGroupContractSchema)(
        response.body,
      );

      expect(response.statusCode).toBe(200);
      expect(contract).toEqual(BillingGroup.contract);
    }),
  );

  it.live("serves typed ProcessGroup contracts", () =>
    Effect.gen(function* () {
      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()("@test/ControlContractEmail", {
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
        const contract = yield* Schema.decodeUnknownEffect(ProcessGroupContractSchema)(
          response.body,
        );

        expect(response.statusCode).toBe(200);
        expect(contract).toEqual(group.contract);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            SyncProcess.layer,
            EmailQueue.layer,
            ProcessStorage.layer,
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

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()("@test/RestEmailQueue", {
        effect: (email) =>
          Ref.update(delivered, (emails) => [...emails, email.to]),
        concurrency: 1,
        paused: true,
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

        const queueStart = yield* requestJson(
          32128,
          `/queues/${encodeURIComponent(EmailQueue.id)}/start`,
          "POST",
        );
        expect(queueStart.statusCode).toBe(200);

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
        Effect.provide(
          Layer.mergeAll(
            SyncProcess.layer,
            EmailQueue.layer,
            ProcessStorage.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("serves canonical protocol envelopes at POST /control", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()("@test/ControlEnvelopeEmail", {
        effect: (_email) => Effect.void,
      }) {}
      class SyncProcess extends Process.Service<SyncProcess>()("@test/ControlEnvelopeProcess", {
        effect: Ref.update(runs, (count) => count + 1),
      }) {}

      yield* Effect.gen(function* () {
        const group = yield* ProcessGroup.make("@test/ControlEnvelopeGroup", [
          SyncProcess,
          EmailQueue,
        ] as const);

        yield* ControlService.make({
          port: 32131,
          group,
        });

        const envelope = yield* makeControlProtocolRequestEnvelope({
          _tag: "RunProcessImmediately",
          processId: SyncProcess.id,
        }, {
          actor: "test",
          reason: "canonical route",
        });
        const response = yield* postJson(32131, "/control", envelope);
        const responseEnvelope = yield* Schema.decodeUnknownEffect(
          ControlProtocolResponseEnvelopeSchema,
        )(response.body);

        expect(response.statusCode).toBe(200);
        expect(responseEnvelope.id).toBe(envelope.id);
        expect(responseEnvelope.response).toMatchObject({
          _tag: "Control",
          status: 200,
          body: { success: true },
        });
        expect(yield* Ref.get(runs)).toBe(1);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            SyncProcess.layer,
            EmailQueue.layer,
            ProcessStorage.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("filters log streams by process target", () =>
    Effect.gen(function* () {
      class SyncProcess extends Process.Service<SyncProcess>()("@test/LogStreamProcess", {
        effect: Effect.void,
      }) {}

      yield* Effect.gen(function* () {
        const group = yield* ProcessGroup.make("@test/LogStreamGroup", [
          SyncProcess,
        ] as const);

        yield* ControlService.make({
          port: 32132,
          group,
        });

        const relay = yield* ProcessManagerLogRelay;
        yield* relay.publish({
          date: "2026-06-01T00:00:00.000Z",
          level: "Info",
          message: "include me",
          annotations: {
            [ProcessManagerLogAnnotationKeys.groupId]: group.id,
            [ProcessManagerLogAnnotationKeys.processId]: SyncProcess.id,
          },
          spans: [],
        });
        yield* relay.publish({
          date: "2026-06-01T00:00:01.000Z",
          level: "Info",
          message: "exclude me",
          annotations: {
            [ProcessManagerLogAnnotationKeys.groupId]: group.id,
            [ProcessManagerLogAnnotationKeys.processId]: "@test/OtherProcess",
          },
          spans: [],
        });

        const response = yield* requestText(
          32132,
          `/logs/stream?follow=false&processId=${encodeURIComponent(SyncProcess.id)}&lines=10`,
        );
        const lines = response.body.trim().split("\n");

        expect(response.statusCode).toBe(200);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("include me");
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            SyncProcess.layer,
            ProcessStorage.layer,
            relayOnlyLayer,
            NodeHttpClient.layerUndici,
          ),
        ),
        Effect.scoped,
      );
    }),
  );

});
