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
            Effect Services written with Hyperlink stay modular and composable across runtimes and
            across the network.
          </p>
          <p className="landing-body">
            An Effect Service lives inside one runtime. A Hyperlink Service isn&apos;t bound to
            one: define it once, run it where it belongs, and call it from any runtime with the
            same typed Handle.
          </p>
          <p className="landing-body">
            The contract carries a schema for every value that crosses the boundary. Serve it over
            HTTP, WebSocket, unix socket, or IPC; the call site never changes, only the Layer at
            the edge says where the implementation lives.
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
