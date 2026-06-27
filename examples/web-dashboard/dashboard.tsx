/**
 * @module examples/web-dashboard/dashboard
 *
 * Picks the layout by viewport — both render the same widgets over the same
 * `live-queues` atoms (the queues run client-side in the browser). Desktop gets the
 * VS Code-style resizable panes; narrow screens get the touch-first drill-down.
 */

import * as React from "react";
import { Boundary } from "./components/ui/boundary";
import { useAtomMount } from "../../src/ui/atom-react";
import { runtime } from "./queue-data";
import { DebugConsole } from "./debug-console";
import { DesktopDashboard } from "./desktop";
import { MobileDashboard } from "./mobile";

const useIsDesktop = (): boolean => {
  const [wide, setWide] = React.useState(
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
};

export const App = (): React.ReactElement => {
  // Keep the runtime LAYER warm for the app's lifetime so navigation never tears it down
  // (which would leave the next view's cold streams blank). Mount the runtime atom itself,
  // NOT fleetAtom — fleetAtom opens ~22 long-lived streams (status+metrics × every queue),
  // which on the single serveAllHttp transport saturates the browser's ~6-connection limit
  // and starves a detail's history/log streams. The bare layer holds no streams.
  useAtomMount(runtime);
  return (
    <Boundary label="dashboard">
      {useIsDesktop() ? <DesktopDashboard /> : <MobileDashboard />}
      <DebugConsole />
    </Boundary>
  );
};
