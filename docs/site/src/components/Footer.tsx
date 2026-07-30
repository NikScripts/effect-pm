// Site footer — brand + link columns + a legal line. The Glossary lives here (a reference utility,
// not a chapter in the reading flow) rather than in the sidebar nav.
//
// Native anchors; hrefs from the typed catalog (same DOM as pre-router).

import * as React from "react";
import { urls } from "../lib/siteRoutes.js";

const GITHUB = "https://github.com/nikolasstow/Hyperlink";
const NPM = "https://www.npmjs.com/package/hyperlink-ts";
const LICENSE = `${GITHUB}/blob/main/LICENSE`;

export function Footer(): React.ReactElement {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <span className="site-footer-name">Hyperlink</span>
          <p className="site-footer-tag">
            Hyperlink Services for Effect: one contract, local or over the network.
          </p>
        </div>
        <nav className="site-footer-cols" aria-label="Footer">
          <div className="site-footer-col">
            <span className="site-footer-heading">Docs</span>
            <a href={urls.api.index()}>API Reference</a>
            <a href={urls.docs("glossary")}>Glossary</a>
            <a href={urls.releases()}>Releases</a>
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
        © 2026 Nikolas Stow · Released under the{" "}
        <a href={LICENSE} target="_blank" rel="noreferrer">
          MIT License
        </a>
        .
      </div>
    </footer>
  );
}
