/**
 * Route.fromEffect / staticFromEffect / mixedFromEffect — bag unions on
 * ~ParamBags and UrlBuilder positional literals.
 */
import { Effect } from "effect";
import { expectTypeOf } from "vitest";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";

const rows = Effect.succeed([
  { slug: "routing" as const },
  { slug: "view-service" as const },
] as const);

const chapter = Route.get("chapter", "/guides/:slug").pipe(
  Route.fromEffect(rows),
);

const baked = Route.get("chapter", "/guides/:slug").pipe(
  Route.staticFromEffect(rows),
);

expectTypeOf(chapter).toMatchTypeOf<Route.Constraint>();
expectTypeOf(baked).toMatchTypeOf<Route.Constraint>();
expectTypeOf(chapter.path).toEqualTypeOf<"/guides/:slug">();

type ChapterBags = (typeof chapter)["~ParamBags"];
const _routing: ChapterBags = { slug: "routing" };
const _view: ChapterBags = { slug: "view-service" };
// @ts-expect-error not in bag union
const _badBag: ChapterBags = { slug: "nope" };
void _routing;
void _view;
void _badBag;

class Site extends Router.make("from-effect-bags").add(chapter) {}

const urls = Route.urlBuilder(Site);
expectTypeOf(urls.chapter).toBeFunction();
expectTypeOf(urls.chapter("routing")).toEqualTypeOf<string>();
expectTypeOf(urls.chapter("view-service")).toEqualTypeOf<string>();

// @ts-expect-error wrong literal slug
urls.chapter("nope");

const mixed = Route.get("mixed", "/guides/:slug").pipe(
  Route.mixedFromEffect({
    static: Effect.succeed([{ slug: "routing" as const }] as const),
    dynamic: Effect.succeed([{ slug: "draft" as const }] as const),
  }),
);

type MixedBags = (typeof mixed)["~ParamBags"];
const _mixedRouting: MixedBags = { slug: "routing" };
const _mixedDraft: MixedBags = { slug: "draft" };
// @ts-expect-error
const _mixedBad: MixedBags = { slug: "nope" };
void _mixedRouting;
void _mixedDraft;
void _mixedBad;

class GroupSite extends Router.make("from-effect-group").add(
  Route.group("app", { topLevel: true }).add(chapter),
) {}

const groupUrls = Route.urlBuilder(GroupSite);
expectTypeOf(groupUrls.chapter("routing")).toEqualTypeOf<string>();

// @ts-expect-error wrong literal under topLevel group
groupUrls.chapter("nope");
