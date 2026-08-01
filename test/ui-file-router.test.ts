/**
 * File-router path discover / emit / Route.fileRoot.
 */
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";
import {
  checkPaths,
  discover,
  emitPaths,
  toRoutePath,
} from "../src/internal/fileRouterPaths";

const fixturePages = NodePath.resolve(
  "examples/ui/file-router/fixtures/pages",
);

const table = [
  { id: "index", routePath: "/" },
  { id: "api_pkg", routePath: "/api/:pkg" },
  { id: "docs_chapter", routePath: "/docs/:chapter" },
  { id: "search", routePath: "/search" },
] as const;

describe("fileRouterPaths", () => {
  it("maps [param] disk paths to :param route paths", () => {
    expect(toRoutePath("/docs/[chapter]")).toBe("/docs/:chapter");
    expect(toRoutePath("/api/[pkg]")).toBe("/api/:pkg");
  });

  it("discovers fixture pages", () => {
    const entries = discover(fixturePages);
    expect(entries.map((e) => e.filePath)).toEqual([
      "/",
      "/api/[pkg]",
      "/docs/[chapter]",
      "/search",
    ]);
    expect(entries.map((e) => e.routePath)).toEqual([
      "/",
      "/api/:pkg",
      "/docs/:chapter",
      "/search",
    ]);
  });

  it("emit is idempotent and check passes", () => {
    const dir = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "hl-fr-"));
    const outFile = NodePath.join(dir, "paths.gen.ts");
    const first = emitPaths({ pagesDir: fixturePages, outFile });
    expect(first.changed).toBe(true);
    const second = emitPaths({ pagesDir: fixturePages, outFile });
    expect(second.changed).toBe(false);
    expect(() => checkPaths({ pagesDir: fixturePages, outFile })).not.toThrow();
    NodeFs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("Route.fileRoot / Router.fileSystem", () => {
  it("builds typed urls from a path table", () => {
    const site = Route.make("fr").add(Route.fileRoot(table));
    const urls = Route.urlBuilder(site);
    expect(urls.index()).toBe("/");
    expect(urls.search()).toBe("/search");
    expect(urls.docs_chapter("routing")).toBe("/docs/routing");
    expect(urls.api_pkg("effect")).toBe("/api/effect");

    const fromRouter = Route.make("fr2").add(
      Route.group("root", { topLevel: true }).fromEffect(
        Router.fileSystem(table),
      ),
    );
    expect(Route.urlBuilder(fromRouter).docs_chapter("stores")).toBe(
      "/docs/stores",
    );
  });
});
