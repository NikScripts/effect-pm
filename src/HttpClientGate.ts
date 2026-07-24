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
import type { Runner } from "./Gate";

/**
 * Pipe-friendly: `client.pipe(HttpClientGate.withRunner(runner))`.
 *
 * @category combinators
 * @public
 */
export const withRunner =
  (runner: Runner) =>
  <E, R>(client: HttpClient.HttpClient.With<E, R>): HttpClient.HttpClient.With<E, R> =>
    HttpClient.transform(client, (effect, _request) => runner(effect));

/**
 * Same as {@link withRunner}, argument order for explicit calls.
 *
 * @category combinators
 * @public
 */
export const transformClient = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
  runner: Runner
): HttpClient.HttpClient.With<E, R> => withRunner(runner)(client);

// The module is the namespace: `withRunner` / `transformClient` are the flat
// top-level exports above, consumed as `import * as HttpClientGate`.
