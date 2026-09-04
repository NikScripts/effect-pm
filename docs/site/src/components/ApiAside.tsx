// Right-rail content for API + search pages, reusing the chapters' aside chrome (.page-aside +
// .toc): module pages get their symbol groups as an on-this-page list; symbol pages get the
// symbol's coordinates and jump links; the search page gets the keyboard cheatsheet.

import type { ApiSymbol } from "../lib/api-data.js";
import type { SymbolGroup } from "../lib/api-groups.js";
import { urls } from "../lib/siteRoutes.js";
import * as Router from "../ui/Router.js";

export const ModuleAside = ({ groups }: { readonly groups: ReadonlyArray<SymbolGroup> }) =>
  groups.length > 1 ? (
    <aside className="page-aside">
      <nav className="toc" aria-label="On this page">
        <p className="toc-title">On this page</p>
        <ul>
          {groups.map((g) => (
            <li key={g.anchor}>
              <a href={`#${g.anchor}`}>
                {g.label} <span className="aside-count">{g.symbols.length}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  ) : null;

export const SymbolAside = ({
  s,
  pkg,
  module,
  refsCount,
}: {
  readonly s: ApiSymbol;
  readonly pkg: string;
  readonly module: string;
  readonly refsCount: number;
}) => (
  <aside className="page-aside">
    <nav className="toc" aria-label="Symbol">
      <p className="toc-title">Symbol</p>
      <dl className="aside-facts">
        <dt>Kind</dt>
        <dd>
          <span className={`api-kind api-kind-${s.kind}`}>{s.kind}</span>
        </dd>
        <dt>Module</dt>
        <dd>
          <Router.Link to={urls.api.module(pkg, module)}>{s.entry}</Router.Link>
        </dd>
        <dt>Package</dt>
        <dd>
          <Router.Link to={urls.api.pkg(pkg)}>{pkg}</Router.Link>
        </dd>
        <dt>Source</dt>
        <dd className="aside-source">
          {s.source.file.split("/").pop()}:{s.source.line}
        </dd>
      </dl>
      {refsCount > 0 ? (
        <ul>
          <li>
            <a href="#referenced-by">Referenced by ({refsCount})</a>
          </li>
        </ul>
      ) : null}
    </nav>
  </aside>
);

export const SearchAside = () => (
  <aside className="page-aside">
    <nav className="toc" aria-label="Search help">
      <p className="toc-title">Search</p>
      <ul className="aside-facts-list">
        <li>
          <kbd>⌘K</kbd> open search anywhere
        </li>
        <li>
          <kbd>↑</kbd>
          <kbd>↓</kbd> select a result
        </li>
        <li>
          <kbd>↵</kbd> open it — or with nothing selected, land here
        </li>
        <li>
          <kbd>esc</kbd> close
        </li>
      </ul>
    </nav>
  </aside>
);
