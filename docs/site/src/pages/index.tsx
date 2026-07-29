import { PageMeta } from "../components/PageMeta.js";
// Inline so brand-host `/` paints without fetching `/assets/*.css` (a bad edge
// redirect or stale cache previously left this page as bare text).
import landingCss from "../styles/landing.css?inline";

/**
 * Brand host (`hyperlink.cool`) — quiet product lockup.
 * Full docs demo stays on `dev.hyperlink.cool`.
 */
export default function LandingPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,450;9..40,550;9..40,650&family=Syne:wght@600;700&display=swap"
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
            {/* `p` not `h3`: keeps the lockup look (class-driven) without skipping heading levels. */}
            <p className="landing-sub">for Effect</p>
          </div>
          <p className="landing-motto">
            <span>Define once.</span> <span>Run anywhere.</span>{" "}
            <span className="landing-motto-accent">
              <code>yield*</code> everywhere.
            </span>
          </p>
          <p className="landing-lede">
            One Contract. Local or over the network. The same typed Handle either way.
          </p>
          <nav className="landing-cta" aria-label="Links">
            <a href="https://dev.hyperlink.cool/docs/index">Docs</a>
            <a href="https://github.com/nikolasstow/Hyperlink">GitHub</a>
            <a href="https://www.npmjs.com/package/hyperlink-ts">npm</a>
          </nav>
        </div>
      </section>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
