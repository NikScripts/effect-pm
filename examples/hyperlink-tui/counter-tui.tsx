/**
 * @module examples/hyperlink-tui/counter-tui
 *
 * Runnable entrypoint — renders the resource panel in your terminal.
 *
 *   tsx examples/hyperlink-tui/counter-tui.tsx
 *   # then press i / d / r / q
 */

import { render } from "ink";
import { App } from "./counter-app";

render(<App />);
