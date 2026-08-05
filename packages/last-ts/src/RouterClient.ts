/**
 * @module RouterClient
 *
 * Typed URL builders for a {@link ./Router} catalog (`HttpApiClient.urlBuilder`
 * analogue). Sync — not a Context service; pass the catalog in.
 *
 * ```ts
 * const urls = RouterClient.urlBuilder(Site)
 * urls.home()
 * urls.docs.chapter("routing")
 * ```
 *
 * @public
 */
import type { ApiConstraint } from "./internal/routes";
import * as catalog from "./internal/routes";

/**
 * Typed URL builder for a catalog — path segments as args, optional `{ query }`.
 *
 * @public
 */
export type UrlBuilder<A extends ApiConstraint = ApiConstraint> =
  catalog.UrlBuilder<A>;

/** @public */
export type UrlBuilderLoose = catalog.UrlBuilderLoose;

/** @public */
export type UrlQueryOptions = catalog.UrlQueryOptions;

/**
 * Build the typed URL surface for a catalog (`HttpApiClient.urlBuilder`).
 *
 * @public
 */
export const urlBuilder: <A extends ApiConstraint>(
  self: A,
  options?: { readonly baseUrl?: URL | string | undefined },
) => UrlBuilder<A> = catalog.urlBuilder;
