/**
 * @module examples/hyperlink-web/app
 *
 * The whole dashboard: point the shipped {@link Dashboard} at the hub. The built-in widgets
 * (queues, daemons, API taps, subgroups) are derived from each tag — this file hard-codes nothing
 * about those. The one exception is `WorkerPool`, a consumer-defined multi-node resource with no
 * built-in card: a custom {@link WorkerPoolCard} is bound to its key and layered **onto** the
 * shipped `base` set via `withEntries` — so that one resource gets a bespoke card and every other
 * widget stays exactly as shipped.
 *
 * Prefer `View.only(WorkerPool, CustomCard)` on a compose Layer when Dashboard accepts an extra
 * view Layer; until then `forKey` / `widgets` remains the working fallback.
 */
import * as React from "react";
import { Dashboard, base, forKey, withEntries } from "../../src/web";
import { ServicesHub, WorkerPool, runtime } from "./hub";
import { WorkerPoolCard } from "./worker-pool-card";

// Fallback until View.only can merge into Dashboard’s compose layer — key beats kind.
const widgets = withEntries(base, [forKey(WorkerPool.key, WorkerPoolCard)]);

export const App = (): React.ReactElement => (
  // No header here — the Dashboard renders its own group breadcrumb (⬢ ServicesHub …).
  // `min-h-[100dvh]` (dynamic viewport), NOT `min-h-screen` (=100vh): on mobile Safari `100vh` is the
  // *large* viewport (toolbars collapsed), so a `100vh` shell is taller than the visible area whenever
  // the address bar shows → the page scrolls a sliver. `dvh` tracks the actual visible height and
  // matches the fullscreen detail's own `h-[100dvh]`.
  <div className="min-h-[100dvh] bg-background text-foreground">
    <Dashboard runtime={runtime} group={ServicesHub} widgets={widgets} />
  </div>
);
