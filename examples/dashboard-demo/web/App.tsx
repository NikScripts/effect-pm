import { OperatorDashboard } from "../../../src/ops-ui";
import "../../../src/ops-ui/styles.css";
import { createFetchControlPlaneAdapter } from "../../../src/react/adapters/fetch";
import {
  DashboardDemoGroup,
  DashboardDemoQueue,
  DashboardTick,
} from "../demo.tags";

const port = createFetchControlPlaneAdapter({
  baseUrl: "/api/control",
  defaultInit: { credentials: "same-origin" },
});

export const App = () => (
  <OperatorDashboard
    port={port}
    for={DashboardDemoGroup}
    processes={[DashboardTick]}
    queues={[DashboardDemoQueue]}
    layoutStorageKey="effect-pm.dashboard-demo.layout.v1"
    chromeStorageKey="effect-pm.dashboard-demo.chrome.v1"
    title="effect-pm control demo"
    description={(
      <>
        Browser calls <code>/api/control</code> through the Vite gateway while the
        private ControlService stays on localhost.
      </>
    )}
  />
);
