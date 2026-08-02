/**
 * **HttpClientGate** — pipe-friendly {@link HttpClient.transform} that runs every
 * request effect through a {@link Gate.Runner}.
 *
 * @remarks
 * `transform` sees the **entire** `execute` pipeline (DNS/TLS/body included), whereas
 * `HttpApiClient`’s `transformResponse` only wraps decode stages after the fetch completes.
 * Pair with {@link Gate.makeRunner} or the runner produced inside
 * {@link Gate.httpApiClient}.
 *
 * @module HttpClientGate
 */

import { HttpClient } from "effect/unstable/http";
import type { RateLimiterError } from "effect/unstable/persistence/RateLimiter";
import type { Runner } from "./Gate";

/**
 * Pipe-friendly: `client.pipe(HttpClientGate.withRunner(runner))`.
 *
 * Widens the client error channel with {@link RateLimiterError} — the runner may
 * raise it when a rate limit is configured (honest channel; never erased).
 *
 * @category combinators
 * @public
 */
export const withRunner =
  (runner: Runner) =>
  <E, R>(
    client: HttpClient.HttpClient.With<E, R>,
  ): HttpClient.HttpClient.With<E | RateLimiterError, R> =>
    HttpClient.transform(client, (effect, _request) => runner(effect));

/**
 * Same as {@link withRunner}, argument order for explicit calls.
 *
 * @category combinators
 * @public
 */
export const transformClient = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
  runner: Runner,
): HttpClient.HttpClient.With<E | RateLimiterError, R> =>
  withRunner(runner)(client);

// The module is the namespace: `withRunner` / `transformClient` are the flat
// top-level exports above, consumed as `import * as HttpClientGate`.
