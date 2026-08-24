/**
 * Page success kind for HttpApi-shaped endpoints — peer of Json/Text encodings.
 *
 * An endpoint with {@link Page} success is a UI destination; builder `handle`
 * takes a React page typed from the endpoint’s params/query schemas.
 *
 * @internal
 */
import type * as React from "react";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import {
  HttpApiEndpoint,
  HttpApiSchema,
} from "effect/unstable/httpapi";

declare module "effect/Schema" {
  namespace Annotations {
    interface Augment {
      /** Marks a success schema as a last-ts Page (React / HTML) response. */
      readonly "~lastTsPage"?: true | undefined;
    }
  }
}

const resolvePage = SchemaAST.resolveAt<true>("~lastTsPage");

/**
 * Nominal brand so `IsPageEndpoint` can detect Page success at the type level.
 *
 * @internal
 */
export declare const PageTypeId: unique symbol;

/**
 * Success schema for page routes (`text/html` peer of `asJson`).
 *
 * @internal
 */
export type Page = Schema.Top & {
  /** Phantom brand — optional so the runtime schema simply omits it; the real
   *  discriminator is the `~lastTsPage` annotation ({@link isPageSchema}). */
  readonly [PageTypeId]?: typeof PageTypeId;
};

/**
 * Success schema for page routes (`text/html` peer of `asJson`).
 *
 * @internal
 */
export const Page: Page = Schema.String.annotate({
  "~lastTsPage": true,
}).pipe(HttpApiSchema.asText({ contentType: "text/html" }));

/** @internal */
export const isPageSchema = (schema: Schema.Top): boolean =>
  resolvePage(schema.ast) === true;

/** @internal */
export const isPageEndpoint = (
  endpoint: HttpApiEndpoint.Constraint & {
    readonly success?: ReadonlySet<Schema.Top> | undefined;
  },
): boolean => {
  if (!HttpApiEndpoint.isHttpApiEndpoint(endpoint)) return false;
  const success = endpoint.success;
  if (success === undefined) return false;
  for (const schema of success) {
    if (isPageSchema(schema)) return true;
  }
  return false;
};

/**
 * Phantom on {@link ../route.get} results — survives codec wraps on `~Success`.
 *
 * @internal
 */
export type PageEndpointBrand = {
  readonly "~lastTsPageEndpoint": true;
};

/** The runtime stamp for {@link PageEndpointBrand} — brands are real properties here. */
export const pageEndpointBrand: PageEndpointBrand = {
  "~lastTsPageEndpoint": true,
};

/** @internal */
export type IsPageEndpoint<E> = E extends PageEndpointBrand ? true : false;

type SchemaType<S> = [S] extends [never] ? never
  : S extends { readonly Type: infer T } ? T
  : never;

/**
 * React page props derived from an endpoint’s params/query schemas
 * (`HttpApiEndpoint.~Request` path/query slice + pathname/href).
 *
 * @internal
 */
export type PagePropsFromEndpoint<E> = {
  readonly pathname: string;
  readonly href: string;
  readonly params:
    E extends { readonly "~Params": infer Params } ?
      [SchemaType<Params>] extends [never] ? Record<never, never>
      : SchemaType<Params>
    : Record<never, never>;
  readonly query:
    E extends { readonly "~Query": infer Query } ?
      [SchemaType<Query>] extends [never] ? Record<never, never>
      : SchemaType<Query>
    : Record<never, never>;
};

/**
 * Page handler — component, Effect → ReactNode, or a {@link ../Page} mint
 * (builder unwraps `.default`).
 *
 * @internal
 */
export type PageHandlerInput<E> =
  | import("./pageMint").AnyPage
  | React.ComponentType<PagePropsFromEndpoint<E>>
  | React.ComponentType<Record<string, never>>
  | Effect.Effect<
    | React.ReactNode
    | React.ComponentType<Record<string, never>>
    | React.ComponentType<PagePropsFromEndpoint<E>>,
    any,
    any
  >;

/**
 * Handler input for one endpoint — Page → UI; else Effect API handler.
 *
 * @internal
 */
export type HandlerForEndpoint<E> = IsPageEndpoint<E> extends true
  ? PageHandlerInput<E>
  : E extends {
    readonly "~Request": infer Request;
  } ? (request: Request) => Effect.Effect<unknown, unknown, unknown>
  : (request: unknown) => Effect.Effect<unknown, unknown, unknown>;

/**
 * Props for `api.groups[GroupId].routes[EndpointId]` — pass the catalog type
 * plus group / endpoint ids.
 *
 * @internal
 */
export type PageProps<
  Api extends {
    readonly groups: Record<
      string,
      { readonly routes: Record<string, unknown> }
    >;
  },
  GroupId extends keyof Api["groups"] & string,
  EndpointId extends keyof Api["groups"][GroupId]["routes"] & string,
> = PagePropsFromEndpoint<Api["groups"][GroupId]["routes"][EndpointId]>;
