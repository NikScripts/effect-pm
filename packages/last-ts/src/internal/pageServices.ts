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
 * @internal
 */
export type DocumentValue = {
  readonly title: string | undefined;
};

/**
 * Effect API for the legacy Outlet-local title bag (internal bridge only).
 * Apps write with {@link ../Page.document} + {@link ../Document.Cell}.
 *
 * @internal
 */
export type DocumentApi = {
  readonly set: (title: string) => Effect.Effect<void>;
  readonly get: Effect.Effect<DocumentValue>;
};

/**
 * Legacy Outlet-local document service (internal). Prefer {@link ../Page.document}.
 *
 * @internal
 */
export class Document extends Context.Service<Document, DocumentApi>()(
  "last-ts/Page/Document",
) {}
