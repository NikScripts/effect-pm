/**
 * Render the context-link demo to HTML (stdout).
 *
 * Run: `pnpm run example:last-context-link`
 */
import { renderToString } from "react-dom/server";
import * as React from "react";
import { App } from "./Demo";

const html = renderToString(React.createElement(App));
console.log(html);
