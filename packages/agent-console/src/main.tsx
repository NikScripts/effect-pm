import type * as React from "react";
import { createRoot } from "react-dom/client";
import * as History from "last-ts/History";
import * as Router from "last-ts/Router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installSafeAreaResumeFix } from "./safeAreaResumeFix";
import { site } from "./site";
import "./styles.css";

installSafeAreaResumeFix();

const router = History.service(site);

const App = (): React.ReactElement => (
  <ErrorBoundary>
    <Router.Provider value={router}>
      <Router.Outlet />
    </Router.Provider>
  </ErrorBoundary>
);

const el = document.getElementById("root");
if (el !== null) {
  createRoot(el).render(<App />);
}
