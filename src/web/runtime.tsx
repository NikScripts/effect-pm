/**
 * @module web/runtime
 *
 * Web re-export of shared {@link ../ui/runtime} — `RuntimeProvider` + `useRuntime`.
 * Observe via `Observe.use(tag, *View.pack)` / `NodeView.use`.
 */
export {
  type AnyRuntime,
  RuntimeProvider,
  useRuntime,
} from "../ui/runtime";
