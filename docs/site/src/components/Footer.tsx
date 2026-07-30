// Site footer — brand + link columns + a legal line. The Glossary lives here (a reference utility,
// not a chapter in the reading flow) rather than in the sidebar nav.

import * as React from "react";
import * as Router from "../ui/Router.js";

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
            <Router.Link to={(u) => u.api.index()}>API Reference</Router.Link>
            <Router.Link to={(u) => u.docs("glossary")}>Glossary</Router.Link>
            <Router.Link to={(u) => u.releases()}>Releases</Router.Link>
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
