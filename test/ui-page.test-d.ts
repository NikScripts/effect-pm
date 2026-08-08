/**
 * Page.make / Page.static classes — mode on the class (no deleted helpers).
 */
import { Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Page from "last-ts/Page";

class About extends Page.make() {}
class Search extends Page.make({
  query: { q: Schema.optionalKey(Schema.String) },
}) {}
class Home extends Page.static() {}

expectTypeOf(About.mode).toEqualTypeOf<"dynamic">();
expectTypeOf(Search.mode).toEqualTypeOf<"dynamic">();
expectTypeOf(Home.mode).toEqualTypeOf<"static">();
expectTypeOf(Page.isPage(About)).toEqualTypeOf<boolean>();
