/**
 * React bridge for {@link ../Observe.use} — reads {@link ../ui/runtime.useRuntime}.
 * Typechecked under `src/ui` (imports UI runtime).
 * @internal
 */
import * as React from "react";
import { useRuntime } from "../ui/runtime";
import { bind, type AtomTag, type Pack } from "./observe";

/**
 * Discharge a pack under {@link ../ui/runtime.RuntimeProvider}.
 */
export const use = <Svc, Out extends object, R = never>(
  tag: AtomTag<Svc, R>,
  pack: Pack<Svc, Out>,
): Out => {
  const runtime = useRuntime();
  return React.useMemo(() => bind(runtime)(tag, pack), [runtime, tag, pack]);
};
