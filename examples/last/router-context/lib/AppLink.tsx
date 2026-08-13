/**
 * @module examples/last/router-context/lib/AppLink
 *
 * Catalog-typed {@link Router.Link} — types from path-only {@link ./Catalog}.
 */
import * as React from "react";
import type { To, Urls } from "./Catalog";
import * as Router from "last-ts/Router";

/**
 * In-app `to` is {@link To} / urlBuilder callback only — no bare string.
 */
export const Link = (props: {
  readonly to?: To | ((urls: Urls) => To);
  readonly out?: string;
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly replace?: boolean;
}): React.ReactElement =>
  React.createElement(
    Router.Link as (p: typeof props) => React.ReactElement,
    props,
  );
