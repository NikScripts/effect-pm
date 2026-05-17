/**
 * @module examples/shared/process-group-http
 *
 * HTTP + queue helpers for **`examples/forms/process-group/*`** contract demos.
 */

import { Duration, Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { responseBodyJson } from "../../src/internal/json.js";

export const requestJson = (
  port: number,
  path: string,
): Effect.Effect<unknown, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      HttpClientRequest.get(`http://127.0.0.1:${String(port)}${path}`),
    ).pipe(Effect.orDie);
    const text = yield* response.text.pipe(Effect.orDie);
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
