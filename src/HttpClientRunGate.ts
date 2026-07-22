/**
 * **HttpClientRunGate** — pipe-friendly {@link HttpClient.transform} that runs every
 * request effect through a {@link GateRunner}.
 *
 * @remarks
 * `transform` sees the **entire** `execute` pipeline (DNS/TLS/body included), whereas
 * `HttpApiClient`’s `transformResponse` only wraps decode stages after the fetch completes.
 * Pair with {@link Gate.makeRunner} or the runner produced inside
 * {@link HttpApiHyperlink.make}.
 *
 * @module HttpClientRunGate
 */

import { HttpClient } from "effect/unstable/http";
import type { GateRunner } from "./Gate";

/**
 * Pipe-friendly: `client.pipe(HttpClientRunGate.withRunner(runner))`.
 *
 * @category combinators
 * @public
 */
export const withRunner =
  (runner: GateRunner) =>
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
  runner: GateRunner
): HttpClient.HttpClient.With<E, R> => withRunner(runner)(client);

// The module is the namespace: `withRunner` / `transformClient` are the flat
// top-level exports above, consumed as `import * as HttpClientRunGate`.
