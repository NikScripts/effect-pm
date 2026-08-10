/**
 * Page.make / Page.static — options + mode brands.
 */
import { Effect, Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as React from "react";
import * as Page from "last-ts/Page";

class About extends Page.make(React.createElement("h1", null, "About")) {}
class Search extends Page.make(
  { query: { q: Schema.optionalKey(Schema.String) } },
  Effect.succeed(React.createElement("span", null, "search")),
) {}
class Home extends Page.static(React.createElement("h1", null, "Home")) {}

expectTypeOf(About.mode).toEqualTypeOf<"dynamic">();
expectTypeOf(Search.mode).toEqualTypeOf<"dynamic">();
expectTypeOf(Home.mode).toEqualTypeOf<"static">();
expectTypeOf(Page.isPage(About)).toEqualTypeOf<boolean>();
