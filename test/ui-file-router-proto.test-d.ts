/**
 * Typed file-router prototype — proves codegen yields a real path union.
 *
 * Regenerate fixtures: `node examples/ui/file-router/scripts/gen-paths.mjs`
 */
import type {
  FilePath,
  FileRouteId,
  RoutePath,
} from "../examples/ui/file-router/paths.gen";
import {
  filePaths,
  protoSite,
  protoUrls,
} from "../examples/ui/file-router/api";

// ----- FilePath / RoutePath are closed unions (not `string`) -----

const chapterFile: FilePath = "/docs/[chapter]";
const chapterRoute: RoutePath = "/docs/:chapter";
const home: FilePath = "/";
void chapterFile;
void chapterRoute;
void home;

// @ts-expect-error not in the discovered fixture tree
const missing: FilePath = "/nope";
void missing;

type Expect<T extends true> = T;
type Eq<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true
  : false;

type _paths = Expect<
  Eq<FilePath, "/" | "/api/[pkg]" | "/docs/[chapter]" | "/search">
>;
type _routes = Expect<
  Eq<RoutePath, "/" | "/api/:pkg" | "/docs/:chapter" | "/search">
>;
type _ids = Expect<
  Eq<FileRouteId, "index" | "api_pkg" | "docs_chapter" | "search">
>;
type _const = Expect<Eq<(typeof filePaths)[number], FilePath>>;
void null as unknown as _paths;
void null as unknown as _routes;
void null as unknown as _ids;
void null as unknown as _const;

// ----- UrlBuilder ids from fileSystem → fromEffect -----

const _home: string = protoUrls.index();
const _docs: string = protoUrls.docs_chapter("routing");
const _api: string = protoUrls.api_pkg("effect");
const _search: string = protoUrls.search();
void _home;
void _docs;
void _api;
void _search;
void protoSite;

// @ts-expect-error unknown file-route id is not on the builder
protoUrls.missing();
