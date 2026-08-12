/**
 * Main column — page body region.
 */
import type * as React from "react";

/** Main column wrapper — HTML for `<main>` lives here. */
export const Root = (props: {
  readonly children?: React.ReactNode;
}): React.ReactElement => (
  <main className="main">{props.children}</main>
);
