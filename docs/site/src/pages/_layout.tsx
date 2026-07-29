import type { ReactNode } from "react";

/**
 * Root shell for every route — document chrome only (no docs stylesheet).
 * Book routes import `docs.css` from `(book)/_layout.tsx`. Coming-soon `/`
 * inlines its own CSS so a failed `/assets/*` fetch cannot unstyle the brand host.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* description/og tags are PER-PAGE (PageMeta) — a layout-level description here would
          duplicate them (React 19 hoists but does not dedupe meta by name) */}
      {/* Override Waku's default viewport: `viewport-fit=cover` lets the page paint under
          the notch/safe-area, so html's dark background fills it instead of white. */}
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      {/* Solid theme-color matches html background so the notch isn’t a white band. */}
      <meta name="theme-color" content="#f7f9fc" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#12151a" media="(prefers-color-scheme: dark)" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      {children}
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
