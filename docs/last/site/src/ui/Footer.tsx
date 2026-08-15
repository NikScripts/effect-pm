/**
 * Site footer.
 */
import type * as React from "react";

export const Brand = (): React.ReactElement => (
  <div className="footer-brand">
    <span className="footer-name">last.ts</span>
    <p className="footer-tag">Effect + React building blocks</p>
  </div>
);

export const Legal = (): React.ReactElement => (
  <p className="footer-legal">
    Official docs for <code>last-ts</code>.
  </p>
);

/** Full footer — HTML for this region lives here. */
export const Footer = (): React.ReactElement => (
  <footer className="footer">
    <div className="footer-inner">
      <Brand />
      <Legal />
    </div>
  </footer>
);
