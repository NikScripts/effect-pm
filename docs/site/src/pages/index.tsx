import { PageMeta } from "../components/PageMeta.js";

// Landing — full-viewport brand hero. The docs proper start at /docs/index.
export default function LandingPage() {
  return (
    <>
      <PageMeta
        title="Hyperlink for Effect"
        description="Hyperlink Services for Effect — define a Service once, run it in any runtime, and yield* the same typed Handle everywhere."
      />
      <section className="landing">
        <div className="landing-inner">
          <h1 className="landing-title">Hyperlink</h1>
          <h3 className="landing-sub">for Effect</h3>
          <div className="landing-tagline">
            <span>Define once</span>
            <span>run anywhere</span>
            <span>
              <code>yield*</code> everywhere
            </span>
          </div>
          <p className="landing-pitch">
            An Effect Service lives inside one runtime. A Hyperlink doesn&apos;t: declare its
            contract once, run the implementation wherever it belongs — in-process, another
            process, another machine — and reach it from every runtime through the same typed
            Handle. Queues, long-running processes, and scheduled work included, with a dashboard
            that already knows them.
          </p>
          <p className="landing-soon">Coming soon</p>
          <a className="landing-preview" href="/docs/index">
            Preview the docs →
          </a>
        </div>
      </section>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
