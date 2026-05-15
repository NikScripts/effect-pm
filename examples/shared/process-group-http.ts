/**
 * @module examples/shared/process-group-http
 *
 * HTTP + queue helpers for **`examples/forms/process-group/*`** contract demos.
 */

import { Duration, Effect, Schema } from "effect";

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

export const requestJson = (
  port: number,
  path: string,
): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    const nodeHttp: typeof import("node:http") = yield* Effect.promise(() =>
      import("node:http"),
    );
    const text = yield* Effect.callback<string>((resume) => {
      const req = nodeHttp.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "GET",
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: unknown) => {
            body = appendChunk(body, chunk);
          });
          res.on("end", () => resume(Effect.succeed(body)));
        },
      );
      req.on("error", (error) => resume(Effect.succeed(String(error))));
      req.end();
    });
    return yield* Schema.decodeUnknownEffect(responseBodyJson)(text).pipe(
      Effect.orDie,
    );
  });

export const waitForCompleted = (
  queue: { readonly completed: Effect.Effect<number> },
  expected: number,
) =>
  Effect.gen(function* () {
    while ((yield* queue.completed) < expected) {
      yield* Effect.sleep(Duration.millis(5));
    }
  });
