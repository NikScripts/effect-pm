import { PageMeta } from "../../../components/PageMeta.js";
import { urls } from "../../../lib/siteRoutes.js";

/**
 * Redirect for the short-lived `/docs/hyperlinks` slug (renamed to
 * `/docs/hyperlink-services`; never "Hyperlinks" plural).
 */
const target = urls.docs("hyperlink-services");

export default function HyperlinksRedirect() {
  return (
    <>
      <PageMeta
        title="Moved: Hyperlink Factories"
        description={`This standards page moved to ${target}.`}
        path={target}
        noIndex
      />
      <meta httpEquiv="refresh" content={`0;url=${target}`} />
      <article className="prose">
        <h1>Moved</h1>
        <p>
          The Hyperlink Factories standards chapter now lives at{" "}
          <a href={target}>{target}</a>.
        </p>
      </article>
    </>
  );
}

export const getConfig = async () => ({ render: "static" } as const);
