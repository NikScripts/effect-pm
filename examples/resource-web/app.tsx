/**
 * @module examples/resource-web/app
 *
 * The whole dashboard: point the shipped {@link Dashboard} at the hub. The built-in widgets
 * (queues, processes, API taps, subgroups) are derived from each tag — this file hard-codes nothing
 * about those. The one exception is `WorkerPool`, a consumer-defined multi-node resource with no
 * built-in card: a custom {@link WorkerPoolCard} is bound to its key and layered **onto** the
 * shipped `base` set via `withEntries` — so that one resource gets a bespoke card and every other
 * widget stays exactly as shipped.
 */
import * as React from "react";
import { Dashboard, base, forKey, withEntries } from "../../src/web";
import { ServicesHub, WorkerPool, runtime } from "./hub";
import { WorkerPoolCard } from "./worker-pool-card";

// Extend the shipped widget set with one per-key card. Key beats kind, so `WorkerPool` renders as
// `WorkerPoolCard` instead of the generic resource fallback; nothing else changes.
const widgets = withEntries(base, [forKey(WorkerPool.key, WorkerPoolCard)]);

export const App = (): React.ReactElement => (
  // No header here — the Dashboard renders its own group breadcrumb (⬢ ServicesHub …).
  <div className="min-h-screen bg-background text-foreground">
    <Dashboard runtime={runtime} group={ServicesHub} widgets={widgets} />
  </div>
);
