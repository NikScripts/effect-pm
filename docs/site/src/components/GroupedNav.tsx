"use client";

// The grouped, collapsible chapter tree — used in BOTH the mobile menu overlay and the
// desktop sidebar. Groups default open; collapsing one persists (localStorage) so it stays
// closed across pages/reloads. The active page is highlighted. When a filter query is
// present, every group is force-open and only matching items show.
//
// Soft-nav via Router.Link (Waku); hrefs from the typed catalog / nav builders.

import * as React from "react";
import type { NavGroup } from "../lib/docs-content.js";
import { asLinkTo } from "../lib/siteRoutes.js";
import * as Router from "../ui/Router.js";

const STORAGE_KEY = "docs-nav-collapsed";

export function GroupedNav({
  groups,
  query = "",
  onNavigate,
}: {
  readonly groups: ReadonlyArray<NavGroup>;
  readonly query?: string;
  readonly onNavigate?: () => void;
}): React.ReactElement {
  const { pathname: path } = Router.useRouter();
  // SSR renders all-open (empty set); the persisted set is applied after mount to avoid
  // a hydration mismatch.
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(
    new Set(),
  );

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setCollapsed(
            new Set(parsed.filter((x): x is string => typeof x === "string")),
          );
        }
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  const toggle = (label: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore quota/availability */
      }
      return next;
    });
  };

  const q = query.trim().toLowerCase();
  const filtering = q !== "";

  return (
    <div className="nav-groups">
      {groups.map((g) => {
        const items = filtering
          ? g.items.filter((i) => i.title.toLowerCase().includes(q))
          : g.items;
        if (items.length === 0) return null;
        if (g.lone) {
          return (
            <div key={g.label} className="nav-group nav-lone">
              {items.map((i) => (
                <Router.Link
                  key={i.href}
                  className="nav-lone-link"
                  to={asLinkTo(i.href)}
                  aria-current={i.href === path ? "page" : undefined}
                  onClick={onNavigate}
                >
                  {i.title}
                </Router.Link>
              ))}
            </div>
          );
        }
        const open = filtering || !collapsed.has(g.label);
        return (
          <div key={g.label} className="nav-group">
            <button
              type="button"
              className="nav-group-head"
              aria-expanded={open}
              onClick={() => toggle(g.label)}
            >
              {g.label}
              <span
                className={`nav-caret${open ? " open" : ""}`}
                aria-hidden="true"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            {open ? (
              <div className="nav-group-items">
                {items.map((i) => (
                  <Router.Link
                    key={i.href}
                    to={asLinkTo(i.href)}
                    aria-current={i.href === path ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    {i.title}
                  </Router.Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
