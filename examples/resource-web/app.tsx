/**
 * @module examples/resource-web/app
 *
 * The whole dashboard: point the shipped {@link Dashboard} at the hub. Every widget
 * (queues, processes, nested groups) is derived from each tag — this file hard-codes
 * nothing about the resources.
 */
import * as React from "react";
import { Dashboard } from "../../src/web";
import { ServicesHub, runtime } from "./hub";

export const App = (): React.ReactElement => (
  <div className="min-h-screen bg-background text-foreground">
    <header className="border-b px-4 py-3 text-sm font-semibold">ServicesHub · resource dashboard</header>
    <Dashboard runtime={runtime} group={ServicesHub} />
  </div>
);
