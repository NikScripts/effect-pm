import { describe, expect, it } from "@effect/vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { hastToHtml } from "../src/lib/hast-html.js";
import { inertTemplate, prerenderedHtml } from "../src/lib/inert-html.js";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

const walk = (dir: string, out: Array<string> = []): Array<string> => {
  for (const entry of readdirSync(dir)) {
    const p = nodePath.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
};

describe("inert-html", () => {
  it("dangerouslySetInnerHTML is WRITTEN exactly once in src (the boundary module)", () => {
    const offenders: Array<string> = [];
    let total = 0;
    for (const file of walk(srcDir)) {
      // count code occurrences, not comment mentions
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
        .join("\n");
      const n = (code.match(/dangerouslySetInnerHTML/g) ?? []).length;
      if (n > 0) {
        total += n;
        offenders.push(`${nodePath.relative(srcDir, file)} (${n})`);
      }
    }
    expect(offenders).toStrictEqual(["lib/inert-html.tsx (1)"]);
    expect(total).toBe(1);
  });

  it("accepts our pipelines' markup (escaped code text cannot false-positive)", () => {
    // escaped code sample containing scary-looking TEXT — must pass
    const html =
      '<span class="line"><span style="color:#111">&lt;button onclick=&quot;x()&quot;&gt; and javascript: in prose</span></span>';
    expect(() => prerenderedHtml({}, html, "test")).not.toThrow();
  });

  it("refuses forbidden elements", () => {
    expect(() => prerenderedHtml({}, "<span></span><script>alert(1)</script>", "test")).toThrow(
      /unsafe markup/
    );
    expect(() => prerenderedHtml({}, '<iframe src="https://x"></iframe>', "test")).toThrow(
      /unsafe markup/
    );
  });

  it("refuses inline event handlers and javascript: URLs inside tags", () => {
    expect(() => prerenderedHtml({}, '<span onclick="x()">hi</span>', "test")).toThrow(
      /unsafe markup/
    );
    expect(() => prerenderedHtml({}, '<a href="javascript:alert(1)">hi</a>', "test")).toThrow(
      /unsafe markup/
    );
  });

  it("inertTemplate serializes hast itself — text is escaped on the way through", () => {
    const el = inertTemplate({ className: "twoslash-popups" }, [
      {
        type: "element",
        tagName: "span",
        properties: { class: "x" },
        children: [
          {
            type: "text",
            value: "<script>alert(1)</script>",
          },
        ],
      },
    ]);
    // building it does not throw (the serializer escaped the scary text before the check)…
    expect(el.type).toBe("template");
    // …and the escaping guarantee itself: the same node serializes with the text neutralized
    const html = hastToHtml({
      type: "element",
      tagName: "span",
      properties: { class: "x" },
      children: [
        {
          type: "text",
          value: "<script>alert(1)</script>",
        },
      ],
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
