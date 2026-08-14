/**
 * File-router path discover / emit / Route.fileRoot.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";
import {
  checkPaths,
  discover,
  emitPaths,
  nodeLayer,
  toRoutePath,
} from "../src/internal/fileRouterPaths";

const fixturePagesEffect = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.resolve("examples/ui/file-router/fixtures/pages");
});

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

  it.effect("discovers fixture pages", () =>
    Effect.gen(function* () {
      const fixturePages = yield* fixturePagesEffect;
      const entries = yield* discover(fixturePages);
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
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("strips (group) segments from the served path", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectory({ prefix: "hl-fr-group-" });
      const bookDir = path.join(dir, "(book)");
      yield* fs.makeDirectory(path.join(bookDir, "docs"), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(bookDir, "docs", "[chapter].tsx"),
        "export default function Chapter() { return null }\n",
      );
      yield* fs.writeFileString(
        path.join(bookDir, "search.tsx"),
        "export default function Search() { return null }\n",
      );
      const entries = yield* discover(dir);
      expect(entries.map((e) => e.filePath)).toEqual([
        "/docs/[chapter]",
        "/search",
      ]);
      expect(entries.map((e) => e.routePath)).toEqual([
        "/docs/:chapter",
        "/search",
      ]);
      yield* fs.remove(dir, { recursive: true, force: true });
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("emit is idempotent and check passes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixturePages = yield* fixturePagesEffect;
      const dir = yield* fs.makeTempDirectory({ prefix: "hl-fr-" });
      const outFile = path.join(dir, "paths.gen.ts");
      const first = yield* emitPaths({ pagesDir: fixturePages, outFile });
      expect(first.changed).toBe(true);
      const second = yield* emitPaths({ pagesDir: fixturePages, outFile });
      expect(second.changed).toBe(false);
      yield* checkPaths({ pagesDir: fixturePages, outFile });
      yield* fs.remove(dir, { recursive: true, force: true });
    }).pipe(Effect.provide(nodeLayer)),
  );
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
      Route.group("root", { topLevel: true }).effect(
        Router.fileSystem(table),
      ),
    );
    expect(Route.urlBuilder(fromRouter).docs_chapter("stores")).toBe(
      "/docs/stores",
    );
  });
});
