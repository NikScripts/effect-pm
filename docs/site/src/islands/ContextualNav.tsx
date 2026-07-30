"use client";

// The DESKTOP sidebar's contextual switch: standards chapters replace the regular nav while
// you're inside the standards book, with a way back. Soft-nav updates pathname via the
// Waku-backed router so the switch tracks in-app navigation without a full reload.

import * as React from "react";
import type { NavGroup } from "../lib/docs-content.js";
import { GroupedNav } from "../components/GroupedNav.js";
import * as Router from "../ui/Router.js";

export function ContextualNav({
  main,
  standards,
  standardsHrefs,
}: {
  readonly main: ReadonlyArray<NavGroup>;
  readonly standards: ReadonlyArray<NavGroup>;
  readonly standardsHrefs: ReadonlyArray<string>;
}): React.ReactElement {
  const { pathname } = Router.useRouter();
  const inStandards = standardsHrefs.includes(pathname);
  return <GroupedNav groups={inStandards ? standards : main} />;
}
