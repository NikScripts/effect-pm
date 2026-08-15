/**
 * Book sidebar as View.make default slot — standards book swaps via provideService.
 *
 * Presentational nav (plain anchors + shared `.nav-*` classes). Soft-nav /
 * collapse stay on `GroupedNav` in the mobile overlay; this slot dogfoods
 * View.make defaults without pulling Waku into the chrome layer.
 */
import * as React from "react";
import { Effect, Layer } from "effect";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";
import type { NavGroup } from "../lib/docs-content.js";

export type BookSidebarProps = {
  readonly groups: ReadonlyArray<NavGroup>;
  /** Active pathname for `aria-current` (optional — island supplies it). */
  readonly pathname?: string;
};

const bookNav = (
  props: BookSidebarProps,
  book: "main" | "standards",
): React.ReactElement =>
  React.createElement(
    "div",
    { className: "nav-groups", "data-book": book },
    props.groups.map((g) => {
      if (g.lone) {
        return React.createElement(
          "div",
          { key: g.label, className: "nav-group nav-lone" },
          g.items.map((i) =>
            React.createElement(
              "a",
              {
                key: i.href,
                className: "nav-lone-link",
                href: i.href,
                "aria-current":
                  i.href === props.pathname ? ("page" as const) : undefined,
              },
              i.title,
            ),
          ),
        );
      }
      return React.createElement(
        "div",
        { key: g.label, className: "nav-group" },
        React.createElement(
          "div",
          { className: "nav-group-head", role: "presentation" },
          g.label,
        ),
        React.createElement(
          "div",
          { className: "nav-group-items" },
          g.items.map((i) =>
            React.createElement(
              "a",
              {
                key: i.href,
                href: i.href,
                "aria-current":
                  i.href === props.pathname ? ("page" as const) : undefined,
              },
              i.title,
            ),
          ),
        ),
      );
    }),
  );

/**
 * Desktop sidebar slot — default = main book nav.
 * Standards book overrides with {@link standardsSidebar}.
 */
export class BookSidebar extends View.make<BookSidebar, BookSidebarProps>()(
  "docs/site/BookSidebar",
  (props) => bookNav(props, "main"),
) {}

/** Standards-book chrome — same nav tree, marked for CSS / a11y. */
export const standardsSidebar = (
  props: BookSidebarProps,
): React.ReactElement => bookNav(props, "standards");

class BookShell extends View.make<BookShell, BookSidebarProps>()(
  "docs/site/BookShell",
) {
  static layer = Layer.effect(
    BookShell,
    Effect.gen(function* () {
      const Side = yield* BookSidebar;
      return (props: BookSidebarProps) => React.createElement(Side, props);
    }),
  );
}

class StandardsShell extends View.make<StandardsShell, BookSidebarProps>()(
  "docs/site/StandardsShell",
) {
  static layer = Layer.effect(
    StandardsShell,
    Effect.gen(function* () {
      const Side = yield* BookSidebar;
      return (props: BookSidebarProps) => React.createElement(Side, props);
    }).pipe(Effect.provideService(BookSidebar, standardsSidebar)),
  );
}

/** Main docs book — default {@link BookSidebar}. */
export const MainBook = Last.provide(BookShell, BookShell.layer);

/** Standards book — Sidebar overridden for this tree. */
export const StandardsBook = Last.provide(StandardsShell, StandardsShell.layer);
