"use client";

/**
 * Root layout — Document.FieldsProvider + Layout.DefaultRoot (html + Head + Outlet).
 */
import type { ReactNode } from "react";
import * as Document from "last-ts/Document";
import * as Layout from "last-ts/Layout";
import { siteCell } from "../lib/document";

export default function Root(props: { readonly children: ReactNode }) {
  return (
    <Document.FieldsProvider cell={siteCell}>
      <Layout.DefaultRoot.Component>{props.children}</Layout.DefaultRoot.Component>
    </Document.FieldsProvider>
  );
}
