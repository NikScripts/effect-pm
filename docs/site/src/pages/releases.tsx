import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as nodePath from "node:path";
import { PageMeta } from "../components/PageMeta.js";
import { loadHighlighter, renderJsdocToReact } from "../lib/highlight.js";
import { runServer } from "../lib/runtime.js";
import { slugify } from "../lib/slug-text.js";

// /releases — the CHANGELOG rendered as a page (the release ritual maintains it; this gives the
// changesets a public face). One section per `## version` heading, anchored, with a version rail.
// Git history stays on GitHub — this page is the curated story, not the commit log.

const readChangelog = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = nodePath.join(process.cwd(), "../..", "CHANGELOG.md");
  return yield* fs.readFileString(path);
}).pipe(Effect.orElseSucceed(() => ""));

interface Release {
  readonly version: string;
  readonly anchor: string;
  readonly body: string;
}

const parseReleases = (text: string): ReadonlyArray<Release> =>
  text
    .split(/^## /m)
    .slice(1) // drop the `# package` preamble
    .map((section) => {
      const newline = section.indexOf("\n");
      const version = section.slice(0, newline).trim();
      return {
        version,
        anchor: slugify(version),
        body: section.slice(newline + 1),
      };
    });

export default async function ReleasesPage() {
  const text = await runServer(readChangelog);
  await loadHighlighter();
  const releases = parseReleases(text);
  return (
    <>
      <PageMeta
        title="Releases — hyperlink-ts"
        description="Release history for hyperlink-ts — every version's changes, from the changelog."
      />
      <article className="prose">
        <h1>Releases</h1>
        {releases.length === 0 ? (
          <p className="search-note">No changelog found.</p>
        ) : (
          releases.map((r) => (
            <section className="release" id={r.anchor} key={r.anchor}>
              <h2 className="release-version">{r.version}</h2>
              {renderJsdocToReact(r.body)}
            </section>
          ))
        )}
      </article>
      <aside className="page-aside">
        <nav className="toc" aria-label="Versions">
          <p className="toc-title">Versions</p>
          <ul>
            {releases.map((r) => (
              <li key={r.anchor}>
                <a href={`#${r.anchor}`}>{r.version}</a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
