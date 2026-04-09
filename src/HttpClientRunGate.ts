/**
 * Wrap an {@link HttpClient.HttpClient} so every `execute` (and thus get/post/…) runs
 * through a {@link RunResourceRunner}.
 *
 * Uses `HttpClient.transform`, which brackets the full request effect — unlike
 * `HttpApiClient`’s `transformResponse`, which only sees decode steps after the fetch.
 *
 * @module HttpClientRunGate
 */

import { HttpClient } from "effect/unstable/http";
import type { RunResourceRunner } from "./RunResource";

/**
 * Pipe-friendly: `client.pipe(HttpClientRunGate.withRunner(runner))`.
 *
 * @public
 */
export const withRunner =
  (runner: RunResourceRunner) =>
  <E, R>(client: HttpClient.HttpClient.With<E, R>): HttpClient.HttpClient.With<E, R> =>
    HttpClient.transform(client, (effect, _request) => runner(effect));

/**
 * Same as {@link withRunner}, argument order for explicit calls.
 *
 * @public
 */
export const transformClient = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
  runner: RunResourceRunner
): HttpClient.HttpClient.With<E, R> => withRunner(runner)(client);

/**
 * @public
 */
export const HttpClientRunGate = {
  withRunner,
  transformClient,
} as const;
