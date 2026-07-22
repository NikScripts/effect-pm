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
            Hyperlink removes the layer you would otherwise write between runtimes: the server in
            front of a Service, the client for each caller, and the wiring for both.
          </p>
          <p className="landing-body">
            What that buys is freedom of placement. Services stop needing a topology designed up
            front, where one server runs these specific programs and every change is a refactor.
            Move a Service to another machine, or spread one across several: reassign its node,
            and every call site stays as it was.
          </p>
          <p className="landing-body">
            The API stays small. A Tag declares the contract, with a schema for every value that
            crosses. Serve the Service in one runtime, connect from another, and{" "}
            <code>yield*</code> the same typed Handle in both, whether the two runtimes are
            parallel processes on one machine or opposite sides of a network.
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
