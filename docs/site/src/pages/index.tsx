import { PageMeta } from "../components/PageMeta.js";
// Inline so brand-host `/` paints without fetching `/assets/*.css` (a bad edge
// redirect or stale cache previously left this page as bare text).
import landingCss from "../styles/landing.css?inline";

// Brand host (`hyperlink.cool`) — coming-soon lockup only. The docs demo is on
// `dev.hyperlink.cool` (host gate redirects `/` there to `/docs/index`).
export default function LandingPage() {
  return (
    <>
      <style>{landingCss}</style>
      <PageMeta
        title="Hyperlink for Effect"
        description="Hyperlink Services for Effect — define a Service once, run it in any runtime, and yield* the same typed Handle everywhere."
        path="/"
      />
      <div className="landing-atmosphere" aria-hidden="true" />
      <section className="landing">
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
            <span>One Contract. Local or over the network.</span>
            <span>The same typed Handle either way.</span>
          </p>
          <p className="landing-soon">Coming soon</p>
        </div>
      </section>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
