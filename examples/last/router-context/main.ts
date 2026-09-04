/**
 * Render the router-context demo to HTML (stdout).
 *
 * Run: `pnpm run example:last-router-context`
 */
import { renderToString } from "react-dom/server";
import * as React from "react";
import { Effect } from "effect";
import * as App from "./App";

const html = renderToString(React.createElement(App.App));

Effect.runSync(Effect.log(html));
