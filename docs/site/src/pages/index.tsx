import { chapterBySlug } from "../lib/content.js";
import { renderChapter } from "../lib/docs-content.js";
import { PrevNext } from "../components/PrevNext.js";
import { DraftBanner, PageAside } from "../components/PageAside.js";
import { PageMeta } from "../components/PageMeta.js";
import { firstParagraphs } from "../components/page-desc.js";

// Home = the "Getting started" overview chapter, rendered through the Effect pipeline.
export default async function HomePage() {
  const chapter = chapterBySlug("index");
  if (!chapter) return <p>Missing content/index.dj</p>;
  const { element, meta, toc } = await renderChapter(chapter.raw);
  return (
    <>
      <PageMeta title={`${meta.title} — effect-pm`} description={firstParagraphs(chapter.raw)} />
      <DraftBanner meta={meta} />
      <article className="prose">
        {element}
        <PrevNext slug="index" />
      </article>
      <PageAside meta={meta} toc={toc} />
    </>
  );
}

// Dynamic in dev so content edits re-render (HMR); static SSG in the build.
export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
