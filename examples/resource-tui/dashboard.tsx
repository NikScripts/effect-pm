/**
 * @module examples/resource-tui/dashboard
 *
 * Entry point for the Ink dashboard — the app itself (and `runDashboard`) lives in
 * `./dashboard-app`, so `hyperlink` can launch the same TUI in-process without this module's
 * launch-on-import side effect. See `dashboard-app.tsx` for the keys/usage.
 *
 *   pnpm run example:dashboard
 */
import { runDashboard } from "./dashboard-app";

runDashboard();
