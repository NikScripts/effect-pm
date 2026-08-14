/**
 * Page.Request / Document — Effect services only (RSC-safe, no React).
 *
 * @internal
 */
import { Context, Effect } from "effect";

/**
 * Matched page request (params/query/pathname/href) — HttpApi `~Request` slice.
 *
 * @public
 */
export type RequestValue = {
  readonly params: Record<string, string>;
  readonly query: Record<string, string>;
  readonly pathname: string;
  readonly href: string;
};

/**
 * Effect service for the current match (`yield* Page.Request`).
 *
 * @public
 */
export class Request extends Context.Service<Request, RequestValue>()(
  "last-ts/Page/Request",
) {}

/**
 * Document fields bag (title today; extend later).
 *
 * @public
 */
export type DocumentValue = {
  readonly title: string | undefined;
};

/**
 * Effect API for document fields (`yield* Page.Document`, then `.set`).
 *
 * @public
 */
export type DocumentApi = {
  readonly set: (title: string) => Effect.Effect<void>;
  readonly get: Effect.Effect<DocumentValue>;
};

/**
 * Set-anywhere document fields (`yield* Page.Document`).
 *
 * @public
 */
export class Document extends Context.Service<Document, DocumentApi>()(
  "last-ts/Page/Document",
) {}
