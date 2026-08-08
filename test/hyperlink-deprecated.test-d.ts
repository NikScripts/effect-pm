import { Effect, Schema } from "effect";
import * as Hyperlink from "../src/Hyperlink";

class Files extends Hyperlink.Tag<Files>()("deprecated-d/Files", {
  move: Hyperlink.effectFn({
    payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
    success: Schema.Void,
  }),
  rename: Hyperlink.effectFn({
    payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
    success: Schema.Void,
  }).pipe(Hyperlink.deprecated),
}) {}

type FilesSvc = Hyperlink.Shape<Files>;
declare const files: FilesSvc;

void files.move;

// Deprecated leaves are {@link DeprecatedOmitted} on ServiceOf (not callable).
const _omitted: Hyperlink.DeprecatedOmitted = files.rename;
void _omitted;

// @ts-expect-error deprecated Handle member is not a callable Effect/fn
void files.rename({ from: "a", to: "b" });

// Impl still requires the deprecated wire member.
const _impl = Hyperlink.make(Files, {
  move: () => Effect.void,
  rename: () => Effect.void,
});
void _impl;

type FilesImpl = Hyperlink.ImplOf<Hyperlink.SpecOf<typeof Files>>;
declare const _needsRename: FilesImpl;
// @ts-expect-error serve/layer impl must still provide deprecated wire members
const _missing: FilesImpl = {
  move: () => Effect.void,
};
void _missing;
void _needsRename;
