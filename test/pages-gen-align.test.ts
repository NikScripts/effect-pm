/**
 * pages.gen.ts render-mode align — Page.make → dynamic after Waku typegen.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  applyRenderModes,
  renderModeOfSource,
} from "../packages/last-ts/src/internal/pagesGenAlign";

describe("pagesGenAlign", () => {
  it("detects Page.make as dynamic and Page.static as static", () => {
    expect(
      renderModeOfSource(`class X extends Page.make({ params: {} }) {}`),
    ).toBe("dynamic");
    expect(renderModeOfSource(`class X extends Page.static() {}`)).toBe(
      "static",
    );
    expect(renderModeOfSource(`export default function Page() {}`)).toBe(
      undefined,
    );
  });

  it("rewrites literal render rows; leaves GetConfigResponse rows", () => {
    const input = `type Page =
| { path: '/_root'; render: 'static' }
| { path: '/docs/[...path]'; render: 'static' }
| { path: '/guides/[slug]'; render: 'static' }
| ({ path: '/about' } & GetConfigResponse<typeof File_About_getConfig>);
`;
    const modes = new Map([
      ["/docs/[...path]", "dynamic" as const],
      ["/guides/[slug]", "static" as const],
    ]);
    const out = applyRenderModes(input, modes);
    expect(out).toContain(
      "| { path: '/docs/[...path]'; render: 'dynamic' }",
    );
    expect(out).toContain("| { path: '/guides/[slug]'; render: 'static' }");
    expect(out).toContain(
      "| ({ path: '/about' } & GetConfigResponse<typeof File_About_getConfig>);",
    );
  });
});
