/**
 * Shared request-options bag for {@link ../Route.get} and {@link ../Page.make}.
 */
import type * as Schema from "effect/Schema";

/**
 * Same options bag as Effect `HttpApiEndpoint.get` / {@link ../Route.get}
 * (`params` / `query` / `headers` / `error`).
 *
 * @public
 */
export type RequestOptions<
  Params extends
    | Schema.Top
    | Schema.Struct.Fields = Schema.Top | Schema.Struct.Fields,
  Query extends
    | Schema.Top
    | Schema.Struct.Fields = Schema.Top | Schema.Struct.Fields,
  Headers extends
    | Schema.Top
    | Schema.Struct.Fields = Schema.Top | Schema.Struct.Fields,
> = {
  readonly params?: Params | undefined;
  readonly query?: Query | undefined;
  readonly headers?: Headers | undefined;
  readonly error?: Schema.Top | ReadonlyArray<Schema.Top> | undefined;
};

type SchemaType<S> = [S] extends [never] ? never
  : S extends { readonly Type: infer T } ? T
  : never;

/** Struct.Fields → Schema.Struct Type (same as HttpApiEndpoint). @internal */
type FieldBagType<P> = [P] extends [Schema.Struct.Fields]
  ? SchemaType<Schema.Struct<P>>
  : [P] extends [Schema.Top] ? SchemaType<P>
  : {};

/**
 * Normalize options.params into a value Type.
 *
 * @internal
 */
export type ParamsTypeOf<O> = O extends { readonly params?: infer P }
  ? [P] extends [undefined] ? {}
  : FieldBagType<P>
  : {};

/**
 * @internal
 */
export type QueryTypeOf<O> = O extends { readonly query?: infer Q }
  ? [Q] extends [undefined] ? {}
  : FieldBagType<Q>
  : {};
