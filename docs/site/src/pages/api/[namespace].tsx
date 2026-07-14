import { ApiEntrySection } from "../../components/ApiEntrySection.js";
import { namespaceBySlug, namespaces, slugForEntry } from "../../lib/api.js";

// One page per namespace — /api/QueueResource, /api/top-level, …
export default async function ApiNamespacePage({ namespace }: { namespace: string }) {
  const ns = namespaceBySlug(namespace);
  if (ns === undefined) return <p className="prose">Namespace not found: {namespace}</p>;
  return (
    <>
      <title>{`${ns.entry} — API — effect-pm`}</title>
      <article className="prose">
        <p className="api-back">
          <a href="/api">← API Reference</a>
        </p>
        <ApiEntrySection ns={ns} />
      </article>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({
        render: "static",
        staticPaths: namespaces().map((ns) => slugForEntry(ns.entry)),
      } as const);
