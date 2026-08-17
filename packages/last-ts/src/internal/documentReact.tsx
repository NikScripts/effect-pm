/**
 * React bridge for Document fields cell + Head mount.
 *
 * @internal
 */
"use client";

import * as React from "react";
import { Context, Effect, Layer } from "effect";
import type { BaseFields, FieldsCell } from "./documentCore";
import { emptyPartial, finalizeFields } from "./documentCore";

export type DocumentCell = FieldsCell<BaseFields> & {
  readonly getHead: () => React.FC;
  readonly setHead: (head: React.FC) => void;
};

export class Cell extends Context.Service<Cell, DocumentCell>()(
  "last-ts/internal/documentReact/Cell",
) {}

export class Fields extends Context.Service<Fields, BaseFields>()(
  "last-ts/internal/documentReact/Fields",
) {}

const CellReact = React.createContext<DocumentCell | null>(null);

export const makeCell = (
  initial: BaseFields,
  initialHead: React.FC,
): DocumentCell => {
  let current = initial;
  let head = initialHead;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of listeners) l();
  };
  return {
    get: () => current,
    update: (f) => {
      current = f(current);
      notify();
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getHead: () => head,
    setHead: (next) => {
      head = next;
      notify();
    },
  };
};

export const useCell = (): DocumentCell => {
  const cell = React.useContext(CellReact);
  if (cell === null) {
    throw new Error(
      "Document: render under Document.FieldsProvider (RootLayout / Last.provider)",
    );
  }
  return cell;
};

/** @internal — null when outside FieldsProvider (bare layout tests). */
export const useCellOption = (): DocumentCell | null =>
  React.useContext(CellReact);

export const useFields = (): BaseFields => {
  const cell = useCell();
  const [fields, setFields] = React.useState(cell.get);
  React.useEffect(() => cell.subscribe(() => setFields(cell.get())), [cell]);
  return fields;
};

/**
 * Provide fields cell to React.
 *
 * @internal
 */
export const Provider = (props: {
  readonly cell: DocumentCell;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(CellReact.Provider, {
    value: props.cell,
    children: props.children,
  });

export const cellLayer = (cell: DocumentCell): Layer.Layer<Cell> =>
  Layer.succeed(Cell, cell);

/** Seed cell from provide fold (throws if incomplete). @internal */
export const cellFromProvide = (
  folded: ReturnType<typeof emptyPartial> & Record<string, unknown>,
  head: React.FC,
): DocumentCell => {
  const complete = finalizeFields(folded);
  if (complete === undefined) {
    throw new Error(
      "Document.provide: missing required title (and titleTransform after fold)",
    );
  }
  return makeCell(complete as BaseFields, head);
};

export type HeadRender = Effect.Effect<React.ReactNode, never, Fields>;

/**
 * Zero-prop Head — uses cell head override or runs render with current Fields.
 *
 * @internal
 */
export const makeHeadComponent = (render: HeadRender): React.FC => {
  const Head: React.FC = () => {
    const fields = useFields();
    const node = React.useMemo(
      () =>
        Effect.runSync(
          render.pipe(Effect.provideService(Fields, fields)) as Effect.Effect<
            React.ReactNode,
            never,
            never
          >,
        ),
      [fields, render],
    );
    return React.createElement(React.Fragment, null, node);
  };
  Head.displayName = "Document.Head";
  return Head;
};

/**
 * Reference Head component — renders whatever the cell’s active Head is.
 *
 * @internal
 */
export const ReferenceHead: React.FC = () => {
  const cell = useCell();
  const [, bump] = React.useState(0);
  React.useEffect(() => cell.subscribe(() => bump((n) => n + 1)), [cell]);
  const Active = cell.getHead();
  return React.createElement(Active);
};
ReferenceHead.displayName = "Document.ReferenceHead";
