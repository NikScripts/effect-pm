/**
 * @module examples/resource-web/app
 *
 * The whole dashboard: point the shipped {@link GroupView} at the hub. Every widget
 * (queues, processes, schedule, nested groups) is derived from each contract — this
 * file hard-codes nothing about the resources.
 */
import * as React from "react";
import { GroupView, RegistryProvider } from "../../src/web";
import { ServicesHub, runtime } from "./hub";

export const App = (): React.ReactElement => (
  <RegistryProvider>
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-3 text-sm font-semibold">
        ServicesHub · resource dashboard
      </header>
      <GroupView runtime={runtime} group={ServicesHub} />
    </div>
  </RegistryProvider>
);
