/**
 * @module examples/web-dashboard/dashboard
 *
 * Picks the layout by viewport — both render the same widgets over the same
 * `live-queues` atoms (the queues run client-side in the browser). Desktop gets the
 * VS Code-style resizable panes; narrow screens get the touch-first drill-down.
 */

import * as React from "react";
import { Boundary } from "./components/ui/boundary";
import { useAtomMount } from "../queue-widget/atom-react";
import { fleetAtom } from "./queue-data";
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
  // keep the data-layer runtime mounted for the app's lifetime, so navigating between the
  // grid and a detail never tears it down (which would leave the next view's cold streams
  // blank until an interaction rebuilt it).
  useAtomMount(fleetAtom);
  return (
    <Boundary label="dashboard">
      {useIsDesktop() ? <DesktopDashboard /> : <MobileDashboard />}
    </Boundary>
  );
};
