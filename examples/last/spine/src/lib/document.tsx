/**
 * Demo Document — fulfill via Document.provide.
 */
import { Effect } from "effect";
import * as Document from "last-ts/Document";

export class SpineDocument extends Document.make()(
  "last-ts/spine/document",
  Effect.gen(function* () {
    const { title, titleTransform, description, links, styles } =
      yield* Document.Fields;
    const resolved = titleTransform(title);
    return (
      <>
        <title>{resolved}</title>
        {description !== undefined ? (
          <meta name="description" content={description} />
        ) : null}
        {links.map((l, i) => (
          <link key={`l-${i}`} rel={l.rel} href={l.href} media={l.media} />
        ))}
        {styles.map((css, i) => (
          <style key={`s-${i}`}>{css}</style>
        ))}
      </>
    );
  }),
) {}

export const spineDocumentLayer = Document.provide(
  SpineDocument,
  Document.title("last-ts spine"),
  Document.titleTransform((t: string) =>
    t === "last-ts spine" ? t : `${t} · last-ts spine`,
  ),
  Document.description("Minimal last-ts spine acceptance demo"),
  Document.lang("en"),
  Document.styleSheet("/styles.css"),
);
