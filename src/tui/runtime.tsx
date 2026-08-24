/**
 * @module tui/runtime
 *
 * TUI re-export of shared {@link ../ui/runtime} — same `RuntimeProvider` context as web.
 * Observe via `Observe.use(tag, *View.pack)` / `NodeView.use`.
 */
export {
  type AnyRuntime,
  RuntimeProvider,
  useRuntime,
} from "../ui/runtime";
