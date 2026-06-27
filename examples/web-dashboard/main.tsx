import "./styles.css";
import { createRoot } from "react-dom/client";
import { RegistryProvider } from "../../src/ui/atom-react";
import { ViewTransitionProvider } from "../../src/web/useViewTransition";
import { App } from "./dashboard";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}

// No <StrictMode>: its dev-only mount → unmount → remount of every effect tears down the
// cold stream atoms (status / metrics / logs) and drops their first emit, leaving panels
// blank until an interaction rebuilds the runtime. Single-pass mount = deterministic
// (production has no StrictMode double-invoke anyway).
createRoot(root).render(
  <RegistryProvider>
    <ViewTransitionProvider>
      <App />
    </ViewTransitionProvider>
  </RegistryProvider>,
);
