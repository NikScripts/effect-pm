// "Edit this page" — GitHub's web editor in the deployed site (main branch; the commit dialog
// still offers branch+PR, and non-collaborators get fork+PR automatically). In DEV it deep-links
// the LOCAL file into the editor instead — docs-while-building. Editor scheme is one string.

const REPO_EDIT = "https://github.com/NikScripts/effect-pm/edit/main";

export const EditThisPage = ({
  sourcePath,
  absPath,
}: {
  /** repo-relative, e.g. "docs/guides/queues.md" */
  readonly sourcePath: string;
  /** absolute path on the dev machine (dev mode only) */
  readonly absPath: string;
}) => (
  <a
    className="edit-page"
    href={import.meta.env.DEV ? `cursor://file${absPath}` : `${REPO_EDIT}/${sourcePath}`}
    {...(import.meta.env.DEV ? {} : { target: "_blank", rel: "noreferrer" })}
  >
    {import.meta.env.DEV ? "Open in editor" : "Edit this page on GitHub"}
  </a>
);
