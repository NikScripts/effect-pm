import { PageMeta } from "../../../components/PageMeta.js";

/**
 * Redirect for the short-lived `/docs/hyperlinks` slug (renamed to
 * `/docs/hyperlink-services`; never "Hyperlinks" plural).
 */
export default function HyperlinksRedirect() {
  return (
    <>
      <PageMeta
        title="Moved: Hyperlink Factories"
        description="This standards page moved to /docs/hyperlink-services."
        path="/docs/hyperlink-services"
        noIndex
      />
      <meta httpEquiv="refresh" content="0;url=/docs/hyperlink-services" />
      <article className="prose">
        <h1>Moved</h1>
        <p>
          The Hyperlink Factories standards chapter now lives at{" "}
          <a href="/docs/hyperlink-services">/docs/hyperlink-services</a>.
        </p>
      </article>
    </>
  );
}

export const getConfig = async () => ({ render: "static" } as const);
