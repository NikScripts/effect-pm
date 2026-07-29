import { PageMeta } from "../components/PageMeta.js";
// Inline so brand-host `/` paints without fetching `/assets/*.css`.
import landingCss from "../styles/landing.css?inline";

/**
 * Brand host (`hyperlink.cool`) — simple product lockup.
 * Docs demo stays on `dev.hyperlink.cool`.
 */
export default function LandingPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,450;9..40,550;9..40,650&family=Syne:wght@700;800&display=swap"
      />
      <style>{landingCss}</style>
      <PageMeta
        title="Hyperlink for Effect"
        description="Hyperlink Services for Effect: define a Service once, run it in any runtime, and yield* the same typed Handle everywhere."
        path="/"
      />
      <section className="landing">
        <div className="landing-glow" aria-hidden="true" />
        <div className="landing-inner">
          <div className="landing-mark">
            <h1 className="landing-title">Hyperlink</h1>
            <p className="landing-sub">for Effect</p>
          </div>
          <p className="landing-motto">
            <span>Define once.</span>
            <span>Run anywhere.</span>
            <span className="landing-motto-accent">
              <code>yield*</code> everywhere.
            </span>
          </p>
          <p className="landing-lede">
            One Contract. Local or over the network. The same typed Handle either way.
          </p>
          <div className="landing-cta">
            <a className="landing-cta-primary" href="https://dev.hyperlink.cool/docs/index">
              Get started
            </a>
            <div className="landing-cta-secondary">
              <a className="landing-cta-link" href="https://github.com/nikolasstow/Hyperlink">
                GitHub
              </a>
              <a className="landing-cta-link" href="https://www.npmjs.com/package/hyperlink-ts">
                npm
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
