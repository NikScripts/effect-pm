import * as Page from "last-ts/Page";
import { PageMeta } from "../../../components/PageMeta.js";
import { urls } from "../../../lib/siteRoutes.js";
import * as Router from "../../../ui/Router.js";

/**
 * Redirect for the short-lived `/docs/hyperlinks` slug (renamed to
 * `/docs/hyperlink-services`; never "Hyperlinks" plural).
 */
const target = urls.docs("hyperlink-services");

function HyperlinksRedirect() {
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

export class HyperlinksRedirectPage extends Page.static(HyperlinksRedirect) {}
