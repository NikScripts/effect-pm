/**
 * Page success kind for HttpApi-shaped endpoints — peer of Json/Text encodings.
 *
 * An endpoint with {@link Page} success is a UI destination; builder `handle`
 * takes a React page. Other success schemas keep Effect `HttpApiEndpoint.Handler`.
 *
 * @internal
 */
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
 * Success schema for page routes (`text/html` peer of `asJson`).
 *
 * @internal
 */
export const Page: Schema.Top = Schema.String.annotate({
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
