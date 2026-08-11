"use client";

/**
 * Root — Last.provider wraps RootLayout.
 */
import type { ReactNode } from "react";
import * as RootLayout from "last-ts/RootLayout";
import { Provider } from "../lib/Provider";

export default function Root(props: { readonly children: ReactNode }) {
  return (
    <Provider>
      <RootLayout.Default.Component>
        {props.children}
      </RootLayout.Default.Component>
    </Provider>
  );
}
