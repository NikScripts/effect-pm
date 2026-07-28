import "../styles/docs.css";
import type { ReactNode } from "react";

/**
 * Root shell for every route — styles + document chrome only.
 * Docs nav / sidebar / footer live in `(book)/_layout.tsx` so `/` (coming soon)
 * never ships that HTML (CSS-hiding is not enough).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* description/og tags are PER-PAGE (PageMeta) — a layout-level description here would
          duplicate them (React 19 hoists but does not dedupe meta by name) */}
      {/* Override Waku's default viewport: `viewport-fit=cover` lets the page paint under
          the notch/safe-area, so html's dark background fills it instead of white. */}
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      {/* Tint the mobile browser chrome (status bar / notch) to match the page in each mode. */}
      <meta name="theme-color" content="#fafbfc" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#141619" media="(prefers-color-scheme: dark)" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      {children}
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
