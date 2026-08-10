import type { ReactNode } from "react";

/**
 * Document shell — sets `<html lang>` for a11y / Lighthouse. Waku's `_root` owns
 * the html/head/body tags; `_layout` remains the chrome (nav, sidebar, footer).
 *
 * Host shell (createRoot) — never a Page mint. Render mode lives on
 * `waku.server.tsx`, not `getConfig`.
 */
export default function RootElement({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body>{children}</body>
    </html>
  );
}
