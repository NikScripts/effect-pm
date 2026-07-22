// The GitHub-facing docs banner: a `> [!NOTE]` alert (styled callout on github.com) fenced in
// sentinel comments, inserted into each chapter's SOURCE by scripts/gen-doc-banners.ts at launch.
// Everything that consumes raw chapter markdown (site renderer, search/llms/description
// generators) strips it with this ONE helper, so the banner exists only where the source is read
// raw — GitHub and editors.

const BEGIN = "<!-- docs-site-link:begin -->";
const END = "<!-- docs-site-link:end -->";

/** Remove the fenced banner block (and one trailing blank line) wherever it sits. */
export const stripDocBanner = (raw: string): string => {
  const start = raw.indexOf(BEGIN);
  if (start === -1) return raw;
  const end = raw.indexOf(END, start);
  if (end === -1) return raw;
  const after = end + END.length;
  const tail = raw.slice(after).replace(/^\n/, "");
  return raw.slice(0, start).replace(/\n$/, "") + (tail.startsWith("\n") ? "" : "\n") + tail;
};

/** The canonical banner block for a page URL. */
export const docBanner = (url: string): string =>
  [
    BEGIN,
    "> [!NOTE]",
    "> You're reading this page's **source**. The rendered version — with navigation, search,",
    `> and live type previews — is at <${url}>.`,
    END,
  ].join("\n");

export const bannerMarkers = { BEGIN, END } as const;
