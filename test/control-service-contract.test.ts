import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
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

const appendChunk = (data: string, chunk: unknown): string => {
  if (typeof chunk === "string") {
    return data + chunk;
  }
  if (chunk instanceof Uint8Array) {
    return data + new TextDecoder().decode(chunk);
  }
  return data;
};

const requestJson = (
  port: number,
  path: string,
): Effect.Effect<{
  readonly statusCode: number;
  readonly body: unknown;
}> =>
  Effect.gen(function* () {
    const nodeHttp: typeof import("node:http") = yield* Effect.promise(() =>
      import("node:http"),
    );
    const response = yield* Effect.callback<{
      readonly statusCode: number;
      readonly text: string;
    }>((resume) => {
      const req = nodeHttp.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "GET",
        },
        (res) => {
          let text = "";
          res.on("data", (chunk: unknown) => {
            text = appendChunk(text, chunk);
          });
          res.on("end", () =>
            resume(
              Effect.succeed({
                statusCode: res.statusCode ?? 0,
                text,
              }),
            ),
          );
        },
      );
      req.on("error", (error) =>
        resume(
          Effect.succeed({
            statusCode: 0,
            text: String(error),
          }),
        ),
      );
      req.end();
    });
    const body = yield* Schema.decodeUnknownEffect(responseBodyJson)(response.text)
      .pipe(Effect.orDie);
    return {
      statusCode: response.statusCode,
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
      }).pipe(provideLayer(ProcessStore.layer)),
    ),
  );
});
