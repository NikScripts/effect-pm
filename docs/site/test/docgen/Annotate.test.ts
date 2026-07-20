import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import prettier from "prettier";
import { createHighlighter } from "shiki";
import * as Annotate from "../../src/docgen/Annotate.js";

const holderUrl = "/api/test/Holder";
const targetUrl = "/api/test/Target";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing (test-only walk)
const anchorsOf = (node: any): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  const visit = (n: any): void => {
    if (n?.type === "element" && n.tagName === "a") {
      const text = (n.children ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => String(c.value))
        .join("");
      out.push([text, String(n.properties?.href ?? "")]);
    }
    for (const child of n?.children ?? []) visit(child);
  };
  visit(node);
  return out;
};

describe("Annotate", () => {
  it("fromParts places links at their offsets in the concatenated text", () => {
    const parts = [
      {
        text: "(holder: ",
        url: Option.none<string>(),
      },
      {
        text: "Holder",
        url: Option.some(holderUrl),
      },
      {
        text: "<",
        url: Option.none<string>(),
      },
      {
        text: "Target",
        url: Option.some(targetUrl),
      },
      {
        text: ">) => ",
        url: Option.none<string>(),
      },
    ];
    expect(Annotate.fromParts(parts)).toStrictEqual([
      {
        start: 9,
        end: 15,
        url: holderUrl,
      },
      {
        start: 16,
        end: 22,
        url: targetUrl,
      },
    ]);
  });

  it("realign survives prettier reformatting (links land on the same identifiers)", () => {
    const source = "(first: Holder<Target>, second: string) => Target";
    const links: ReadonlyArray<Annotate.Link> = [
      {
        start: source.indexOf("Holder"),
        end: source.indexOf("Holder") + 6,
        url: holderUrl,
      },
      {
        start: source.indexOf("Target"),
        end: source.indexOf("Target") + 6,
        url: targetUrl,
      },
      {
        start: source.lastIndexOf("Target"),
        end: source.lastIndexOf("Target") + 6,
        url: targetUrl,
      },
    ];
    // The site's hover formatting: wrap in a type alias, narrow width so parameters break lines.
    const formatted = prettier
      .format(`type _t = ${source}`, {
        parser: "typescript",
        printWidth: 20,
        semi: false,
      })
      .trim()
      .replace(/^type _t =\s*/, "");
    expect(formatted).toContain("\n"); // the reformat actually moved things
    const remapped = Option.getOrThrow(Annotate.realign(links, source, formatted));
    expect(remapped.map((link) => [formatted.slice(link.start, link.end), link.url])).toStrictEqual(
      [
        ["Holder", holderUrl],
        ["Target", targetUrl],
        ["Target", targetUrl],
      ]
    );
  });

  it("realign refuses texts that differ beyond formatting", () => {
    const links: ReadonlyArray<Annotate.Link> = [
      {
        start: 0,
        end: 6,
        url: holderUrl,
      },
    ];
    expect(Option.isNone(Annotate.realign(links, "Holder", "Renamed"))).toBe(true);
  });

  it.effect("transformer turns overlapping shiki tokens into anchors", () =>
    Effect.gen(function* () {
      const code = "declare const a: Holder<Target>";
      const links: ReadonlyArray<Annotate.Link> = [
        {
          start: code.indexOf("Holder"),
          end: code.indexOf("Holder") + 6,
          url: holderUrl,
        },
        {
          start: code.indexOf("Target"),
          end: code.indexOf("Target") + 6,
          url: targetUrl,
        },
      ];
      const hl = yield* Effect.promise(() =>
        createHighlighter({
          themes: ["github-light"],
          langs: ["typescript"],
        })
      );
      const hast = hl.codeToHast(code, {
        lang: "typescript",
        theme: "github-light",
        transformers: [Annotate.transformer({ links })],
      });
      // shiki bakes a token's leading whitespace into its text — the WHOLE token becomes the
      // anchor (same shape the popup linkifier produces), hence the leading space.
      expect(anchorsOf(hast)).toStrictEqual([
        [" Holder", holderUrl],
        ["Target", targetUrl],
      ]);
      hl.dispose();
    })
  );

  it.effect("transformer keeps an injected hover popup OUTSIDE the anchor", () =>
    Effect.gen(function* () {
      const code = "declare const a: Holder<Target>";
      const links: ReadonlyArray<Annotate.Link> = [
        {
          start: code.indexOf("Holder"),
          end: code.indexOf("Holder") + 6,
          url: holderUrl,
        },
      ];
      // Simulates twoslash: restructures the linked token's children into a hover wrapper whose
      // FIRST child is the popup — the anchor must wrap only the visible text.
      const fakeTwoslash = {
        name: "test:fake-twoslash",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing (test-only)
        span: (hast: any, _line: number, _col: number, _lineEl: any, token: any) => {
          if (String(token.content).trim() !== "Holder") return;
          hast.children = [
            {
              type: "element",
              tagName: "span",
              properties: { class: "twoslash-hover" },
              children: [
                {
                  type: "element",
                  tagName: "span",
                  properties: { class: "twoslash-popup-container" },
                  children: [
                    {
                      type: "text",
                      value: "POPUP CONTENT",
                    },
                  ],
                },
                ...hast.children,
              ],
            },
          ];
        },
      };
      const hl = yield* Effect.promise(() =>
        createHighlighter({
          themes: ["github-light"],
          langs: ["typescript"],
        })
      );
      const hast = hl.codeToHast(code, {
        lang: "typescript",
        theme: "github-light",
        transformers: [fakeTwoslash, Annotate.transformer({ links })],
      });
      expect(anchorsOf(hast)).toStrictEqual([[" Holder", holderUrl]]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing (test-only)
      const deepText = (n: any): string =>
        n?.type === "text" ? String(n.value) : (n?.children ?? []).map(deepText).join("");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing (test-only)
      const anchorHoldsPopup = (n: any): boolean =>
        n?.type === "element" && n.tagName === "a"
          ? deepText(n).includes("POPUP CONTENT")
          : (n?.children ?? []).some(anchorHoldsPopup);
      expect(anchorHoldsPopup(hast)).toBe(false);
      expect(deepText(hast)).toContain("POPUP CONTENT"); // the popup itself survives, outside
      hl.dispose();
    })
  );

  it.effect("transformer subtracts the preamble shift", () =>
    Effect.gen(function* () {
      const preamble = "// preamble\n";
      const code = "declare const a: Holder<Target>";
      const links: ReadonlyArray<Annotate.Link> = [
        {
          start: code.indexOf("Target"),
          end: code.indexOf("Target") + 6,
          url: targetUrl,
        },
      ];
      const hl = yield* Effect.promise(() =>
        createHighlighter({
          themes: ["github-light"],
          langs: ["typescript"],
        })
      );
      const hast = hl.codeToHast(preamble + code, {
        lang: "typescript",
        theme: "github-light",
        transformers: [
          Annotate.transformer({
            links,
            shift: preamble.length,
          }),
        ],
      });
      expect(anchorsOf(hast)).toStrictEqual([["Target", targetUrl]]);
      hl.dispose();
    })
  );
});
