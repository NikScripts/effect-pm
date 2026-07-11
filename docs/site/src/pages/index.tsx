import { chapterBySlug } from "../lib/content.js";
import { renderChapter } from "../lib/docs-content.js";

// Home = the "Getting started" overview chapter, rendered through the Effect pipeline.
export default async function HomePage() {
  const chapter = chapterBySlug("index");
  if (!chapter) return <p>Missing content/index.dj</p>;
  const { element, meta } = await renderChapter(chapter.raw);
  return (
    <>
      <title>{`${meta.title} — effect-pm`}</title>
      {element}
    </>
  );
}

// Dynamic in dev so content edits re-render (HMR); static SSG in the build.
export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
