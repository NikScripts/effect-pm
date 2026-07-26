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
          <div className="landing-mark">
            <h1 className="landing-title">
              <a href="/docs/index">Hyperlink</a>
            </h1>
            <h3 className="landing-sub">for Effect</h3>
          </div>
          <p className="landing-motto">
            <span>Define once.</span> <span>Run anywhere.</span>{" "}
            <span className="landing-motto-accent">
              <code>yield*</code> everywhere.
            </span>
          </p>
          <p className="landing-soon">Coming soon</p>
          <div className="landing-content">
          <p className="landing-pitch">
            JavaScript has been multi-core for a decade. Hyperlink makes writing it feel
            single-threaded again.
          </p>
          <p className="landing-body">
            <code>yield*</code> a Service and it answers, from a parallel process, a second
            machine, the far side of the network. Typed end to end, schema-validated at the wire.
            You never write the difference.
          </p>
          <p className="landing-body">
            Heavy work moves off the event loop and onto your other cores, the app spreads across
            machines, and not one call site changes: monolith in dev, fleet in prod, the same
            code either way.
          </p>
          <p className="landing-body">
            Change a contract and the compiler flags every caller, in every process, on every
            machine. One typed surface.
          </p>
          <p className="landing-credit">Inspired by and built on Effect RPC.</p>
          <a className="landing-preview" href="/docs/index">
            Preview the docs →
          </a>
          </div>
        </div>
      </section>
    </>
  );
}

export const getConfig = async () => ({ render: "static" }) as const;
