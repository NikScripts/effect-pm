/**
 * Apply `Page.document` args to Document.Cell.
 *
 * @internal
 */
import type * as React from "react";
import { Effect } from "effect";
import * as core from "./documentCore";
import { Cell } from "./documentReact";
import { hasBrand } from "./predicates";

const DocumentTypeId = "~last-ts/Document" as const;

type AnyDocument = {
  readonly [DocumentTypeId]: typeof DocumentTypeId;
  readonly Head: React.FC;
};

const isDocumentClass = (u: unknown): u is AnyDocument =>
  typeof u === "function" && hasBrand(u, DocumentTypeId);

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
        // Runtime-validated: known document fields are type-checked in, extras pass
        // through — a malformed field is dropped instead of corrupting the cell.
        patches.push(toFieldsPartial(arg));
      }
    }
    if (patches.length === 0) return;
    cell.update((prev) => {
      const asPartial: core.BaseFieldsPartial = { ...prev };
      const folded = core.foldArgs(asPartial, patches);
      const next = core.finalizeFields(folded);
      return next ?? prev;
    });
  });

const isStringArray = (u: unknown): u is ReadonlyArray<string> =>
  Array.isArray(u) && u.every((entry) => typeof entry === "string");

/** Field-by-field runtime validation of a loose document-fields bag. */
const toFieldsPartial = (
  arg: object,
): core.BaseFieldsPartial & Record<string, unknown> => {
  // Mutable while assembling; the readonly view is what leaves this function.
  const out: {
    title?: string;
    description?: string;
    lang?: string;
    titleTransform?: (title: string) => string;
    styles?: ReadonlyArray<string>;
    meta?: core.BaseFieldsPartial["meta"];
    links?: core.BaseFieldsPartial["links"];
    scripts?: core.BaseFieldsPartial["scripts"];
  } & Record<string, unknown> = {};
  for (const [key, value] of Object.entries(arg)) {
    switch (key) {
      case "title":
      case "description":
      case "lang": {
        if (typeof value === "string") out[key] = value;
        break;
      }
      case "titleTransform": {
        if (typeof value === "function") {
          out.titleTransform = (title: string): string => {
            const output: unknown = Reflect.apply(value, undefined, [title]);
            return typeof output === "string" ? output : title;
          };
        }
        break;
      }
      case "styles": {
        if (isStringArray(value)) out.styles = value;
        break;
      }
      case "meta":
      case "links":
      case "scripts": {
        if (Array.isArray(value)) out[key] = value;
        break;
      }
      default: {
        out[key] = value;
      }
    }
  }
  return out;
};
