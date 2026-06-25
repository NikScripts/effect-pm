/**
 * @module web/panels
 *
 * Generic, contract-driven panels: they render whatever the binding produces
 * without knowing the concrete resource. A value (read or latest stream emission)
 * is shown as fields/badges; a command becomes a button (with a confirm step when
 * the contract marks it `destructive`, and a JSON input when it takes a payload).
 *
 * @since 1.0.0
 */
import * as React from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { ResourceUI, ValueAtom } from "./binding";
import { useAtomSet, useAtomValue } from "./atom-react";
import { Badge, Button, ConfirmButton, Field } from "./primitives";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Render an unknown scalar/leaf value compactly. @since 1.0.0 */
export const renderLeaf = (v: unknown): React.ReactNode => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return <Badge tone={v ? "green" : "gray"}>{String(v)}</Badge>;
  if (typeof v === "number") return Number.isInteger(v) ? v : v.toFixed(2);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  if (isRecord(v)) {
    return (
      <span className="font-mono text-xs text-neutral-400">
        {Object.entries(v).map(([k, val]) => `${k}: ${String(val)}`).join("  ")}
      </span>
    );
  }
  return String(v);
};

/** Render an unknown value as a labeled field set (one level deep). @since 1.0.0 */
export const renderValue = (v: unknown): React.ReactNode => {
  if (isRecord(v)) {
    return (
      <div className="flex flex-col gap-0.5">
        {Object.entries(v).map(([k, val]) => (
          <Field key={k} label={k}>{renderLeaf(val)}</Field>
        ))}
      </div>
    );
  }
  return <div className="text-sm text-neutral-200">{renderLeaf(v)}</div>;
};

const useValue = (atom: ValueAtom): { readonly value: unknown; readonly loading: boolean } => {
  const r = useAtomValue(atom);
  return { value: AsyncResult.isSuccess(r) ? r.value : undefined, loading: !AsyncResult.isSuccess(r) };
};

/** Subscribe to a read/stream atom and render its current value. @since 1.0.0 */
export const ValuePanel = (props: {
  readonly atom: ValueAtom;
  readonly render?: (value: unknown) => React.ReactNode;
}): React.ReactElement => {
  const { value, loading } = useValue(props.atom);
  if (loading) return <div className="text-sm text-neutral-600">…</div>;
  return <>{(props.render ?? renderValue)(value)}</>;
};

/** A trigger for one contract command (mutate / payload method). @since 1.0.0 */
export const CommandButton = (props: { readonly ui: ResourceUI; readonly name: string }): React.ReactElement => {
  const command = props.ui.commands[props.name]!;
  const meta = props.ui.meta[props.name];
  const fire = useAtomSet(command);
  const [payload, setPayload] = React.useState("");
  const hasPayload = meta?.kind === "mutate" || meta?.kind === "query"; // payload-carrying ⇒ becomes a command
  const needsInput = props.ui.reads[props.name] === undefined && hasPayload && payloadLikely(props.name);

  const run = (): void => {
    if (needsInput) {
      try {
        fire(payload.trim() === "" ? undefined : (JSON.parse(payload) as unknown));
      } catch {
        // ignore malformed json — leave the field for the user to fix
      }
    } else {
      fire(undefined);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {needsInput ? (
        <input
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          placeholder={`${props.name} payload (json)`}
          className="w-40 rounded border border-neutral-800 bg-neutral-950 px-1 py-0.5 text-xs text-neutral-200"
        />
      ) : null}
      {meta?.destructive === true ? (
        <ConfirmButton onConfirm={run}>{props.name}</ConfirmButton>
      ) : (
        <Button tone="blue" onClick={run}>{props.name}</Button>
      )}
    </div>
  );
};

// heuristic: methods whose name suggests they take data get a payload input.
const payloadLikely = (name: string): boolean =>
  /add|enqueue|prioritize|defer|set|reconcile|configure/i.test(name);
