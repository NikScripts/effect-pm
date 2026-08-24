import * as Page from "last-ts/Page";
import { PageMeta } from "../../../components/PageMeta.js";
import { urls } from "../../../lib/siteRoutes.js";
import * as Router from "../../../ui/Router.js";

/**
 * Permanent redirect for the pre-rename standards URL `/docs/resources`
 * (file was `resources.md`; now `hyperlink-services.md` → `/docs/hyperlink-services`).
 */
const target = urls.docs("hyperlink-services");

function ResourcesRedirect() {
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
          <Router.Link to={target}>{target}</Router.Link>.
        </p>
      </article>
    </>
  );
}

export class ResourcesRedirectPage extends Page.static(ResourcesRedirect) {}
