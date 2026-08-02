/**
 * @module examples/apps/web/app
 *
 * Point the shipped Dashboard at the hub. Family skins come from Dashboard Views;
 * `WorkerPool` brings its own card via `views={workerPoolViews}` (`View.Card.Tag` +
 * `View.only` — see `worker-pool-card.tsx`).
 */
import * as React from "react";
import { Dashboard } from "../../../src/web";
import { ServicesHub, runtime } from "./hub";
import { layer as workerPoolViews } from "./worker-pool-card";

import * as View from "../../../src/ui/View";
export const App = (): React.ReactElement => (
  // No header — Dashboard owns the group breadcrumb (⬢ ServicesHub …).
  // `min-h-[100dvh]` (dynamic viewport), not `min-h-screen` (=100vh): on mobile Safari `100vh` is the
  // *large* viewport (toolbars collapsed), so a `100vh` shell is taller than the visible area whenever
  // the address bar shows → the page scrolls a sliver. `dvh` tracks the actual visible height and
  // matches the fullscreen detail's own `h-[100dvh]`.
  <div className="min-h-[100dvh] bg-background text-foreground">
    <Dashboard runtime={runtime} group={ServicesHub} views={workerPoolViews} />
  </div>
);
