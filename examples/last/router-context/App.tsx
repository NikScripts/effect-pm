/**
 * @module examples/last/router-context/App
 *
 * Edge — provider wraps {@link Router.Outlet} (active-path context mounts there).
 */
import * as React from "react";
import * as Router from "last-ts/Router";
import * as Provider from "./lib/Provider";

export const App = (): React.ReactElement => (
  <Provider.Provider>
    <Router.Outlet />
  </Provider.Provider>
);
