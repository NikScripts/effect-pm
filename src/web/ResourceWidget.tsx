/**
 * @module web/ResourceWidget
 *
 * The generic, contract-driven widget — the web analogue of the CLI/TUI renderers.
 * Given a {@link ResourceUI} it renders every contract method automatically:
 * streaming methods as live panels, queries as value panels, mutations as buttons.
 * `ResourceView` dispatches to a module-aware widget by `ui.kind`, falling back to
 * the generic one — so any resource, including new contracts, renders with no code.
 *
 * @since 1.0.0
 */
import * as React from "react";
import { Atom } from "effect/unstable/reactivity";
import type { ResourceTag, Spec } from "../Resource";
import { makeResourceUI, type ResourceUI } from "./binding";
import { Card, SectionLabel } from "./primitives";
import { CommandButton, ValuePanel } from "./panels";

/** Build (memoised) the UI binding for a tag against a runtime. @since 1.0.0 */
export const useResourceUI = <Self extends R, S extends Spec, R, ER>(
  runtime: Atom.AtomRuntime<R, ER>,
  tag: ResourceTag<Self, S>,
): ResourceUI => React.useMemo(() => makeResourceUI(runtime, tag), [runtime, tag]);

/** Header: display name + a kind badge + optional host. @since 1.0.0 */
export const ResourceHeader = (props: {
  readonly ui: ResourceUI;
  readonly host?: string;
}): React.ReactElement => (
  <div className="mb-2 flex items-center gap-2">
    <strong className="flex-1 truncate text-sm text-neutral-100">{props.ui.displayName}</strong>
    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase text-neutral-400">
      {props.ui.kind}
    </span>
    {props.host !== undefined ? (
      <span className="text-[10px] text-neutral-500">@{props.host}</span>
    ) : null}
  </div>
);

/** Every command (mutation / payload method) as a button row. @since 1.0.0 */
export const CommandBar = (props: { readonly ui: ResourceUI }): React.ReactElement | null => {
  const names = Object.keys(props.ui.commands);
  if (names.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {names.map((name) => <CommandButton key={name} ui={props.ui} name={name} />)}
    </div>
  );
};

/** The fully generic widget — renders the whole contract. @since 1.0.0 */
export const GenericResourceWidget = (props: {
  readonly ui: ResourceUI;
  readonly host?: string;
}): React.ReactElement => {
  const { ui } = props;
  return (
    <Card>
      <ResourceHeader ui={ui} host={props.host} />
      {Object.entries(ui.streams).map(([name, atom]) => (
        <div key={name} className="mb-2">
          <SectionLabel>{name}</SectionLabel>
          <ValuePanel atom={atom} />
        </div>
      ))}
      {Object.keys(ui.reads).length > 0 ? (
        <div className="mb-1">
          {Object.entries(ui.reads).map(([name, atom]) => (
            <div key={name} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-neutral-500">{name}</span>
              <ValuePanel atom={atom} />
            </div>
          ))}
        </div>
      ) : null}
      <CommandBar ui={ui} />
    </Card>
  );
};
