"use client";

/**
 * Root layout — Document.FieldsProvider + RootLayout.Default (html + Head + Outlet).
 */
import type { ReactNode } from "react";
import * as Document from "last-ts/Document";
import * as RootLayout from "last-ts/RootLayout";
import { siteCell } from "../lib/document";

export default function Root(props: { readonly children: ReactNode }) {
  return (
    <Document.FieldsProvider cell={siteCell}>
      <RootLayout.Default.Component>
        {props.children}
      </RootLayout.Default.Component>
    </Document.FieldsProvider>
  );
}
