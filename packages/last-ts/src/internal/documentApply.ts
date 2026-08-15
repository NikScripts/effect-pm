/**
 * Apply `Page.document` args to Document.Cell.
 *
 * @internal
 */
import type * as React from "react";
import { Effect } from "effect";
import * as core from "./documentCore";
import { Cell } from "./documentReact";

const DocumentTypeId = "~last-ts/Document" as const;

type AnyDocument = {
  readonly [DocumentTypeId]: typeof DocumentTypeId;
  readonly Head: React.FC;
};

const isDocumentClass = (u: unknown): u is AnyDocument =>
  typeof u === "function" &&
  u !== null &&
  DocumentTypeId in u &&
  (u as AnyDocument)[DocumentTypeId] === DocumentTypeId;

type ProvideArg = core.ProvideArg<
  core.BaseFieldsPartial & Record<string, unknown>
>;

/** @internal */
export const applyDocumentArgs = (
  ...args: ReadonlyArray<unknown>
): Effect.Effect<void, never, Cell> =>
  Effect.gen(function* () {
    const cell = yield* Cell;
    let rest = args;
    if (rest.length > 0 && isDocumentClass(rest[0])) {
      const doc = rest[0];
      rest = rest.slice(1);
      cell.setHead(doc.Head);
    }
    const patches: Array<ProvideArg> = [];
    for (const arg of rest) {
      if (core.isPatch(arg)) {
        patches.push(arg);
      } else if (typeof arg === "object" && arg !== null) {
        patches.push(arg as ProvideArg);
      }
    }
    if (patches.length === 0) return;
    cell.update((prev) => {
      const asPartial: core.BaseFieldsPartial = { ...prev };
      const folded = core.foldArgs(asPartial, patches);
      const next = core.finalizeFields(folded);
      return (next ?? prev) as core.BaseFields;
    });
  });
