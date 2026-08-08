/**
 * Disk `[...path]` → Route `*path` splat.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  toRouteId,
  toRoutePath,
} from "../packages/last-ts/src/internal/fileRouterPaths";

describe("file-router rest params", () => {
  it("maps [...path] to *path", () => {
    expect(toRoutePath("/docs/[...path]")).toBe("/docs/*path");
    expect(toRouteId("/docs/[...path]")).toBe("docs_path");
  });

  it("still maps [slug] to :slug", () => {
    expect(toRoutePath("/guides/[slug]")).toBe("/guides/:slug");
    expect(toRouteId("/guides/[slug]")).toBe("guides_slug");
  });
});
