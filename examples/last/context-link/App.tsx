/**
 * @module examples/last/context-link/App
 *
 * Edge composition — provider wraps the Tree.
 */
import * as React from "react";
import * as Provider from "./lib/Provider";
import * as Tree from "./lib/Tree";

// ---cut---
export const App = (): React.ReactElement => (
  <Provider.Provider>
    <Tree.Tree />
  </Provider.Provider>
);
