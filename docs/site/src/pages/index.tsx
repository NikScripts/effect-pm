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
          <p className="landing-pitch">The boundary between runtimes disappears.</p>
          <p className="landing-body">
            Place a Service anywhere: a parallel process, a second machine, the other side of the
            world. Calling it never changes.
          </p>
          <p className="landing-body">
            No server to stand up. No client to write. No wiring to keep alive. Move a Service by
            reassigning its node. Scale it by giving it more.
          </p>
          <p className="landing-credit">Inspired by and built on Effect RPC.</p>
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
