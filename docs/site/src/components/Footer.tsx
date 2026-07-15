// Site footer — brand + link columns + a legal line. The Glossary lives here (a reference utility,
// not a chapter in the reading flow) rather than in the sidebar nav.

import * as React from "react";

const GITHUB = "https://github.com/NikScripts/effect-pm";
const NPM = "https://www.npmjs.com/package/@nikscripts/effect-pm";
const LICENSE = `${GITHUB}/blob/main/LICENSE`;

export function Footer(): React.ReactElement {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <span className="site-footer-name">effect-pm</span>
          <p className="site-footer-tag">
            Effect-native processes, queues, and resources — one contract, local or over RPC.
          </p>
        </div>
        <nav className="site-footer-cols" aria-label="Footer">
          <div className="site-footer-col">
            <span className="site-footer-heading">Docs</span>
            <a href="/api">API Reference</a>
            <a href="/docs/glossary">Glossary</a>
          </div>
          <div className="site-footer-col">
            <span className="site-footer-heading">Project</span>
            <a href={GITHUB} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href={NPM} target="_blank" rel="noreferrer">
              npm
            </a>
            <a href={LICENSE} target="_blank" rel="noreferrer">
              License
            </a>
          </div>
        </nav>
      </div>
      <div className="site-footer-legal">
        © 2025 Nikolas Stow · Released under the{" "}
        <a href={LICENSE} target="_blank" rel="noreferrer">
          MIT License
        </a>
        .
      </div>
    </footer>
  );
}
