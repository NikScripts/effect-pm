import { PageMeta } from "../../components/PageMeta.js";

/**
 * Permanent redirect for the pre-rename standards URL `/docs/resources`
 * (file was `resources.md`; now `hyperlinks.md` → `/docs/hyperlinks`).
 */
export default function ResourcesRedirect() {
  return (
    <>
      <PageMeta
        title="Moved — Hyperlink Factories"
        description="This standards page moved to /docs/hyperlinks."
        path="/docs/hyperlinks"
        noIndex
      />
      <meta httpEquiv="refresh" content="0;url=/docs/hyperlinks" />
      <script
        dangerouslySetInnerHTML={{
          __html: 'location.replace("/docs/hyperlinks");',
        }}
      />
      <article className="prose">
        <h1>Moved</h1>
        <p>
          The Hyperlink Factories standards chapter now lives at{" "}
          <a href="/docs/hyperlinks">/docs/hyperlinks</a>.
        </p>
      </article>
    </>
  );
}

export const getConfig = async () => ({ render: "static" } as const);
