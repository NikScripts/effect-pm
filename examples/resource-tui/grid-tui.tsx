/**
 * @module examples/resource-tui/grid-tui
 *
 * Full-screen grid dashboard. Run in a real terminal:
 *
 *   pnpm run example:resource-tui-grid
 *   # ↑↓←→ / hjkl to move, i / d / r to act, q to quit
 */

import { render } from "ink";
import { App } from "./grid-app";

render(<App />);
