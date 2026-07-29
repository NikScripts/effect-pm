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
      {/* Same React key as Waku's DEFAULT_HTML_HEAD viewport — replaces the bare
          `initial-scale=1` tag so we do not ship two viewports (cover must win). */}
      <meta
        key="viewport"
        name="viewport"
        content="width=device-width, initial-scale=1, viewport-fit=cover"
      />
      <meta name="theme-color" content="#e8f2f7" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#0c1c24" media="(prefers-color-scheme: dark)" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      {children}
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
