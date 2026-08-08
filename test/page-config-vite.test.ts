/**
 * pageConfig Vite plugin — injects Waku getConfig from Page.make / Page.static.
 */
import { describe, expect, it } from "@effect/vitest";
import { pageConfig } from "last-ts/vite";

const plugin = pageConfig();
const transform = plugin.transform as (
  code: string,
  id: string,
) => { code: string; map: null } | null;

describe("pageConfig vite plugin", () => {
  it("injects dynamic getConfig for Page.make", () => {
    const src = `
import * as Page from "last-ts/Page"
class Chapter extends Page.make({ params: {} }) {
  static Component = () => null
}
export default Page.asDefault(Chapter)
`;
    const out = transform(src, "/app/src/pages/guides/[slug].tsx");
    expect(out?.code).toContain('render: "dynamic"');
    expect(out?.code).toContain("export const getConfig");
  });

  it("injects static getConfig for Page.static", () => {
    const src = `
import * as Page from "last-ts/Page"
class Home extends Page.static() {
  static Component = () => null
}
export default Page.asDefault(Home)
`;
    const out = transform(src, "/app/src/pages/index.tsx");
    expect(out?.code).toContain('render: "static"');
  });

  it("skips modules that already export getConfig", () => {
    const src = `
export default function Page() { return null }
export const getConfig = async () => ({ render: "dynamic" as const })
`;
    expect(transform(src, "/app/src/pages/x.tsx")).toBeNull();
  });

  it("skips non-pages paths", () => {
    const src = `class Home extends Page.static() {}`;
    expect(transform(src, "/app/src/lib/Home.tsx")).toBeNull();
  });
});
