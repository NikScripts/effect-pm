"use client";

// The DESKTOP sidebar's contextual switch: standards chapters replace the regular nav while
// you're inside the standards book, with a way back. Resolution is client-side on mount — the
// same mechanism (and the same brief pre-hydration default) as GroupedNav's current-page mark.

import * as React from "react";
import type { NavGroup } from "../lib/docs-content.js";
import { GroupedNav } from "../components/GroupedNav.js";

export function ContextualNav({
  main,
  standards,
  standardsHrefs,
}: {
  readonly main: ReadonlyArray<NavGroup>;
  readonly standards: ReadonlyArray<NavGroup>;
  readonly standardsHrefs: ReadonlyArray<string>;
}): React.ReactElement {
  const [inStandards, setInStandards] = React.useState(false);
  React.useEffect(() => {
    setInStandards(standardsHrefs.includes(window.location.pathname));
  }, [standardsHrefs]);
  return <GroupedNav groups={inStandards ? standards : main} />;
}
