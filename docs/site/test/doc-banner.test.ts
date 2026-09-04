import { describe, expect, it } from "@effect/vitest";
import { docBanner, stripDocBanner } from "../src/lib/doc-banner.js";

const page = `{#queues title="Queues"}
# Queues

A queue takes a stream of items.
`;

describe("doc-banner", () => {
  it("strip removes an inserted banner exactly (round-trip)", () => {
    const banner = docBanner("https://example.test/docs/queues");
    const lines = page.split("\n");
    const withBanner = [lines[0], banner, ...lines.slice(1)].join("\n");
    expect(withBanner).toContain("[!NOTE]");
    expect(stripDocBanner(withBanner)).toBe(page);
  });

  it("strip is a no-op without a banner", () => {
    expect(stripDocBanner(page)).toBe(page);
  });

  it("insert-after-strip is idempotent (the maintenance script's loop)", () => {
    const banner = docBanner("https://example.test/docs/queues");
    const insert = (raw: string): string => {
      const lines = stripDocBanner(raw).split("\n");
      const attr = lines[0]?.startsWith("{#") === true ? 1 : 0;
      return [...lines.slice(0, attr), banner, ...lines.slice(attr)].join("\n");
    };
    const once = insert(page);
    expect(insert(once)).toBe(once);
    expect(stripDocBanner(once)).toBe(page);
  });

  it("banner renders as a GitHub alert with the deep link", () => {
    const banner = docBanner("https://example.test/docs/queues");
    expect(banner).toContain("> [!NOTE]");
    expect(banner).toContain("<https://example.test/docs/queues>");
    expect(banner.startsWith("<!-- docs-site-link:begin -->")).toBe(true);
    expect(banner.endsWith("<!-- docs-site-link:end -->")).toBe(true);
  });
});
