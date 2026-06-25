/**
 * @module web/ResourceWidget
 *
 * The generic, contract-driven widget — the web analogue of the CLI/TUI renderers.
 * Given a {@link ResourceUI} it renders every contract method automatically:
 * streaming methods as live panels (a chart for `metrics`, a pane for `logs`),
 * queries as value rows, mutations as buttons. `ResourceView` (in `./widgets`)
 * dispatches to a module-aware widget by `ui.kind`, falling back to this one — so
 * any resource, including new contracts, renders with no code.
 *
 * @since 1.0.0
 */
import * as React from "react";
import { Atom } from "effect/unstable/reactivity";
import type { ResourceTag, Spec } from "../Resource";
import { makeResourceUI, type ResourceUI } from "./binding";
import { Badge, Card, CardBody, SectionLabel } from "./primitives";
import { CommandButton, ValuePanel } from "./panels";
import { LogStream, MetricChart } from "./chart";

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
  <div className="flex items-center gap-2">
    <strong className="flex-1 truncate text-sm">{props.ui.displayName}</strong>
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {props.ui.kind}
    </span>
    {props.host !== undefined ? <Badge tone="blue">@{props.host}</Badge> : null}
  </div>
);

/** Command buttons. Pass `only` to curate which (and in what order). @since 1.0.0 */
export const CommandBar = (props: {
  readonly ui: ResourceUI;
  readonly only?: ReadonlyArray<string>;
}): React.ReactElement | null => {
  const available = props.ui.commands;
  const names =
    props.only !== undefined
      ? props.only.filter((n) => available[n] !== undefined)
      : Object.keys(available);
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => <CommandButton key={name} ui={props.ui} name={name} />)}
    </div>
  );
};

const StreamPanel = (props: { readonly ui: ResourceUI; readonly name: string }): React.ReactElement => {
  const { ui, name } = props;
  if (name === "metrics" && ui.histories[name] !== undefined) {
    return <MetricChart atom={ui.histories[name]} field="throughputPerSec" />;
  }
  if (name === "logs" && ui.histories[name] !== undefined) {
    return <LogStream atom={ui.histories[name]} />;
  }
  return <ValuePanel atom={ui.streams[name]!} />;
};

/** The fully generic widget — renders the whole contract. @since 1.0.0 */
export const GenericResourceWidget = (props: {
  readonly ui: ResourceUI;
  readonly host?: string;
}): React.ReactElement => {
  const { ui } = props;
  return (
    <Card>
      <CardBody className="flex flex-col gap-2.5">
        <ResourceHeader ui={ui} host={props.host} />
        {Object.keys(ui.streams).map((name) => (
          <div key={name}>
            <SectionLabel>{name}</SectionLabel>
            <StreamPanel ui={ui} name={name} />
          </div>
        ))}
        {Object.keys(ui.reads).length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {Object.entries(ui.reads).map(([name, atom]) => (
              <div key={name} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{name}</span>
                <ValuePanel atom={atom} />
              </div>
            ))}
          </div>
        ) : null}
        <CommandBar ui={ui} />
      </CardBody>
    </Card>
  );
};
