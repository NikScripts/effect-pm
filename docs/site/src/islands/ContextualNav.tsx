"use client";

/**
 * @deprecated Prefer {@link BookSidebarIsland} — View.Service sidebar slot.
 * Kept as a thin alias so older imports keep working.
 */
import * as React from "react";
import type { NavGroup } from "../lib/docs-content.js";
import { BookSidebarIsland } from "./BookSidebarIsland.js";

export function ContextualNav(props: {
  readonly main: ReadonlyArray<NavGroup>;
  readonly standards: ReadonlyArray<NavGroup>;
  readonly standardsHrefs: ReadonlyArray<string>;
}): React.ReactElement {
  return React.createElement(BookSidebarIsland, props);
}
