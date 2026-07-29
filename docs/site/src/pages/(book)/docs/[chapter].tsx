import { chapters, chapterBySlug } from "../../../lib/content.js";
import { renderChapter } from "../../../lib/docs-content.js";
import { PrevNext } from "../../../components/PrevNext.js";
import { DraftBanner, PageAside } from "../../../components/PageAside.js";
import { PageMeta } from "../../../components/PageMeta.js";
import { firstParagraphs } from "../../../lib/page-desc.js";
import { EditThisPage } from "../../../components/EditThisPage.js";
import * as nodePath from "node:path";

// One route for every standards chapter. Server component: parse + render through
// the Effect pipeline, SSG'd at build.
export default async function ChapterPage({ chapter }: { chapter: string }) {
  const c = chapterBySlug(chapter);
  if (!c) return <p>Chapter not found: {chapter}</p>;
  const { element, meta, toc } = await renderChapter(c.raw);
  return (
    <>
      <PageMeta
        title={`${meta.title} — Hyperlink`}
        description={firstParagraphs(c.raw)}
        path={`/docs/${chapter}`}
      />
      <DraftBanner meta={meta} />
      <article className="prose">
        {element}
        <EditThisPage
          sourcePath={`docs/${c.group !== "" ? `${c.group}/` : ""}${c.slug}.md`}
          absPath={nodePath.resolve(
            process.cwd(),
            "../..",
            `docs/${c.group !== "" ? `${c.group}/` : ""}${c.slug}.md`
          )}
        />
        <PrevNext slug={chapter} />
      </article>
      <PageAside meta={meta} toc={toc} />
    </>
  );
}

// Dynamic in dev (edits re-render, any slug resolves); static SSG per chapter in build.
// Include top-level pages (`docs/examples.md` → slug `examples`); only `index` is excluded —
// it has its own `/` route. (Previously `group !== ""` dropped every root-level chapter.)
export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({
        render: "static",
        staticPaths: chapters.map((c) => c.slug),
      } as const);
