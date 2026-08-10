/**
 * Site Document — Layer fulfill via Document.provide (Last.provider edge).
 */
import { Effect } from "effect";
import * as Document from "last-ts/Document";

export class SiteDocument extends Document.make()(
  "last-ts/docs/document",
  Effect.gen(function* () {
    const {
      title,
      titleTransform,
      description,
      meta,
      links,
      scripts,
      styles,
    } = yield* Document.Fields;
    const resolved = titleTransform(title);
    return (
      <>
        <title>{resolved}</title>
        {description !== undefined ? (
          <meta name="description" content={description} />
        ) : null}
        {meta.map((m, i) => (
          <meta
            key={`m-${i}`}
            name={m.name}
            property={m.property}
            content={m.content}
          />
        ))}
        {links.map((l, i) => (
          <link
            key={`l-${i}`}
            rel={l.rel}
            href={l.href}
            media={l.media}
            crossOrigin={l.crossOrigin as "anonymous" | undefined}
          />
        ))}
        {styles.map((css, i) => (
          <style key={`s-${i}`}>{css}</style>
        ))}
        {scripts.map((s, i) =>
          s.src !== undefined ? (
            <script key={`js-${i}`} src={s.src} type={s.type} />
          ) : null,
        )}
      </>
    );
  }),
) {}

export const siteDocumentLayer = Document.provide(
  SiteDocument,
  Document.title("last.ts"),
  Document.titleTransform((t: string) =>
    t === "last.ts" ? t : `${t} · last.ts`,
  ),
  Document.description("Effect + React building blocks"),
  Document.lang("en"),
  Document.link({ rel: "preconnect", href: "https://fonts.googleapis.com" }),
  Document.link({
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  }),
  Document.link({
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap",
  }),
  Document.styleSheet("/styles.css"),
);
