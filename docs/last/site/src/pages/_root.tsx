"use client";

/**
 * Host root — `Last.provider` (Document.Cell + soft-nav) wraps RootLayout.
 * CLI/host only — not product API (see last-ts-spine).
 */
import type { ReactNode } from "react";
import * as RootLayout from "last-ts/RootLayout";
import * as Provider from "../lib/Provider";

// Waku debug channel calls `crypto.randomUUID`. Tailscale `http://100.x`
// is not a secure context — polyfill so the dogfood URL works.
const webCrypto = globalThis.crypto as Crypto | undefined;
if (
  webCrypto !== undefined &&
  typeof webCrypto.randomUUID !== "function" &&
  typeof webCrypto.getRandomValues === "function"
) {
  webCrypto.randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

export default function Root(props: { readonly children: ReactNode }) {
  return (
    <Provider.Provider>
      <RootLayout.Default.Component>
        {props.children}
      </RootLayout.Default.Component>
    </Provider.Provider>
  );
}
