/**
 * @module examples/apps/tui/terminal
 *
 * @deprecated Prefer `Hyperlink.cli(group|record)` + `import { layer } from "hyperlink-ts/tui"`.
 * Bare CLI paths open the TUI; full `<resource> <action>` paths run verbs.
 */
export { layer as tuiLayer } from "../../../src/tui";
