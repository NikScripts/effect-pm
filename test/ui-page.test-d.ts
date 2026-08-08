/**
 * Page.make / Page.static classes (replaces path+component stamps).
 */
import { Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Page from "last-ts/Page";

class About extends Page.make() {}
class Search extends Page.make({
  query: { q: Schema.optionalKey(Schema.String) },
}) {}
class Home extends Page.static() {}

expectTypeOf(Page.modeOf(About)).toEqualTypeOf<"dynamic">();
expectTypeOf(Page.modeOf(Search)).toEqualTypeOf<"dynamic">();
expectTypeOf(Page.modeOf(Home)).toEqualTypeOf<"static">();
expectTypeOf(Page.isPage(About)).toEqualTypeOf<boolean>();
