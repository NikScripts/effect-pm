import { describe, expect, it } from "@effect/vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildIndex,
  searchSections,
  searchType,
  tokenize,
  type SearchDoc,
} from "../src/lib/search-core.js";

describe("search-core", () => {
  it("tokenizes identifiers: camelCase and dot-paths split, full word kept", () => {
    expect(tokenize("WorkPool")).toContain("workpool");
    expect(tokenize("WorkPool")).toContain("work");
    expect(tokenize("WorkPool")).toContain("pool");
    expect(tokenize("Hyperlink.ref")).toContain("hyperlink");
    expect(tokenize("Hyperlink.ref")).toContain("ref");
  });

  it("exact name match DOMINATES popularity (the retry lesson)", () => {
    const docs: Array<SearchDoc> = [
      {
        id: "/api/x/M/retry",
        type: "api",
        title: "M.retry",
        url: "/api/x/M/retry",
        summary: "",
        kind: "const",
        pkg: "effect",
        name: "retry",
        refs: 0,
      },
      {
        id: "/api/x/M/txRetry",
        type: "api",
        title: "M.txRetry",
        url: "/api/x/M/txRetry",
        summary: "",
        kind: "interface",
        pkg: "effect",
        name: "txRetry",
        refs: 500,
      },
    ];
    const index = buildIndex(docs);
    const hits = searchType(index, "retry", "api", 10);
    expect(hits[0]?.doc.name).toBe("retry");
  });

  it("popularity breaks near-ties between equally-matched types", () => {
    const docs: Array<SearchDoc> = [
      {
        id: "/api/x/A/Layer",
        type: "api",
        title: "A.Layer",
        url: "/api/x/A/Layer",
        summary: "",
        kind: "interface",
        pkg: "effect",
        name: "Layer",
        refs: 200,
      },
      {
        id: "/api/x/B/Layer",
        type: "api",
        title: "B.Layer",
        url: "/api/x/B/Layer",
        summary: "",
        kind: "interface",
        pkg: "effect",
        name: "Layer",
        refs: 1,
      },
    ];
    const index = buildIndex(docs);
    const hits = searchType(index, "layer", "api", 10);
    expect(hits[0]?.doc.id).toBe("/api/x/A/Layer");
  });

  it("hyperlink-ts outranks a dependency for the same match", () => {
    const docs: Array<SearchDoc> = [
      {
        id: "/api/effect/S/Subscribable",
        type: "api",
        title: "S.Subscribable",
        url: "/api/effect/S/Subscribable",
        summary: "",
        kind: "interface",
        pkg: "effect",
        name: "Subscribable",
        refs: 3,
      },
      {
        id: "/api/hyperlink-ts/Hyperlink/Subscribable",
        type: "api",
        title: "Hyperlink.Subscribable",
        url: "/api/hyperlink-ts/Hyperlink/Subscribable",
        summary: "",
        kind: "interface",
        pkg: "hyperlink-ts",
        name: "Subscribable",
        refs: 3,
      },
    ];
    const index = buildIndex(docs);
    const hits = searchType(index, "subscribable", "api", 10);
    expect(hits[0]?.doc.pkg).toBe("hyperlink-ts");
  });

  it("synonyms reach what prefix search can't (ws → websocket)", () => {
    const docs: Array<SearchDoc> = [
      {
        id: "/api/hyperlink-ts/Hyperlink/protocolWebsocket",
        type: "api",
        title: "Hyperlink.protocolWebsocket",
        url: "/api/hyperlink-ts/Hyperlink/protocolWebsocket",
        summary: "",
        kind: "const",
        pkg: "hyperlink-ts",
        name: "protocolWebsocket",
      },
    ];
    const index = buildIndex(docs);
    const hits = searchType(index, "ws", "api", 10);
    expect(hits.some((h) => h.doc.name === "protocolWebsocket")).toBe(true);
  });

  it("sections split by type", () => {
    const docs: Array<SearchDoc> = [
      {
        id: "/api/hyperlink-ts/Q/queue",
        type: "api",
        title: "Q.queue",
        url: "/api/hyperlink-ts/Q/queue",
        summary: "",
        kind: "const",
        pkg: "hyperlink-ts",
        name: "queue",
      },
      {
        id: "/docs/queues",
        type: "page",
        title: "Queues",
        url: "/docs/queues",
        summary: "about queues",
      },
      {
        id: "/docs/glossary#queue",
        type: "glossary",
        title: "Queue",
        url: "/docs/glossary#queue",
        summary: "a queue",
      },
    ];
    const index = buildIndex(docs);
    const sections = searchSections(index, "queue", { api: 5, pages: 5, glossary: 5 });
    expect(sections.api.length).toBe(1);
    expect(sections.pages.length).toBe(1);
    expect(sections.glossary.length).toBe(1);
  });
});

// Pinned ranking cases over the REAL corpus — skipped when the generated index is absent
// (fresh clone before docs:api). These are the spike's findings as regression tests.
const chunkPaths = ["api.json", "pages.json", "glossary.json"].map((f) =>
  fileURLToPath(new URL(`../public/search/${f}`, import.meta.url))
);
describe.skipIf(chunkPaths.some((p) => !existsSync(p)))("search ranking (real corpus)", () => {
  const docs: ReadonlyArray<SearchDoc> = chunkPaths.flatMap(
    (p) => JSON.parse(readFileSync(p, "utf8")).docs
  );
  const index = buildIndex(docs);
  const top = (q: string): string => searchType(index, q, "api", 1)[0]?.doc.title ?? "";

  it("ref → Hyperlink.ref (hyperlink-ts tier + popularity beat RefField)", () => {
    expect(top("ref")).toBe("Hyperlink.ref");
  });
  it("retry → Effect.retry (exact match beats txRetry's popularity)", () => {
    expect(top("retry")).toBe("Effect.retry");
  });
  it("subscribable → Hyperlink.Subscribable", () => {
    expect(top("subscribable")).toBe("Hyperlink.Subscribable");
  });
  it("queue → a Queue module/type, not an internal schema const", () => {
    expect(/^Queue/.test(top("queue"))).toBe(true);
  });
});
