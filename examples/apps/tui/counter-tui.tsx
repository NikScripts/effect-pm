/**
 * @module examples/apps/tui/counter-tui
 *
 * Runnable entrypoint — renders the HyperService panel in your terminal.
 *
 *   tsx examples/apps/tui/counter-tui.tsx
 *   # then press i / d / r / q
 */

import { render } from "ink";
import { App } from "./counter-app";

render(<App />);
