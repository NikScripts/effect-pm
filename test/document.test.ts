/**
 * Document fields fold + provide + Page.document cell merge.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Document from "last-ts/Document";
import * as Page from "last-ts/Page";

describe("Document fields", () => {
  it("Document.provide builds Cell; Page.document merges title", async () => {
    const layer = Document.provide(
      Document.Default,
      Document.title("last.ts"),
      Document.titleTransform((t) =>
        t === "last.ts" ? t : `${t} · last.ts`,
      ),
      Document.lang("en"),
      Document.styleSheet("/a.css"),
      Document.styleSheet("/b.css"),
    );
    const program = Effect.gen(function* () {
      const cell = yield* Document.Cell;
      expect(cell.get().title).toBe("last.ts");
      expect(cell.get().links.length).toBe(2);
      yield* Page.document(
        Document.title("Chapter"),
        { links: [{ rel: "stylesheet", href: "/only.css" }] },
      );
      expect(cell.get().title).toBe("Chapter");
      expect(cell.get().titleTransform("Chapter")).toBe("Chapter · last.ts");
      expect(cell.get().links).toEqual([
        { rel: "stylesheet", href: "/only.css" },
      ]);
    }).pipe(Effect.provide(layer));
    await Effect.runPromise(program);
  });

  it("makeCell throws without title", () => {
    expect(() =>
      Document.makeCell(
        Document.Default,
        Document.titleTransform((t) => t),
      ),
    ).toThrow(/missing required title/);
  });

  it("Page.document(Doc, partial) swaps Head", async () => {
    class Site extends Document.make<{ readonly ogImage?: string }>()(
      "test/document/site",
      Effect.gen(function* () {
        const f = yield* Document.Fields;
        return f.title;
      }),
    ) {}

    const layer = Document.provide(
      Document.Default,
      Document.title("base"),
      Document.titleTransform((t) => t),
    );
    const program = Effect.gen(function* () {
      const cell = yield* Document.Cell;
      const before = cell.getHead();
      yield* Page.document(Site, { title: "Site", ogImage: "/og.png" });
      expect(cell.get().title).toBe("Site");
      expect(cell.getHead()).not.toBe(before);
      expect(cell.getHead()).toBe(Site.Head);
    }).pipe(Effect.provide(layer));
    await Effect.runPromise(program);
  });
});
