import type * as React from "react";
import { createRoot } from "react-dom/client";
import * as History from "last-ts/History";
import * as Router from "last-ts/Router";
import { site } from "./site";
import "./styles.css";

const router = History.service(site);

const App = (): React.ReactElement => (
  <Router.Provider value={router}>
    <Router.Outlet />
  </Router.Provider>
);

const el = document.getElementById("root");
if (el !== null) {
  createRoot(el).render(<App />);
}
