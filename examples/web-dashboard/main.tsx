import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RegistryProvider } from "../queue-widget/atom-react";
import { ViewTransitionProvider } from "../../src/web/useViewTransition";
import { App } from "./dashboard";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <RegistryProvider>
      <ViewTransitionProvider>
        <App />
      </ViewTransitionProvider>
    </RegistryProvider>
  </StrictMode>,
);
