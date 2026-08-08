/**
 * Page.make / Page.static — HttpApi-shaped page classes + Props.
 */
import { Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Page from "last-ts/Page";

class About extends Page.make() {}

class Chapter extends Page.make({
  params: { slug: Schema.Literals(["routing", "view-service"]) },
  query: { tab: Schema.optionalKey(Schema.String) },
}) {}

class Home extends Page.static() {}

expectTypeOf(Page.isPage(About)).toEqualTypeOf<boolean>();
expectTypeOf(Page.modeOf(About)).toEqualTypeOf<"dynamic">();
expectTypeOf(Page.modeOf(Home)).toEqualTypeOf<"static">();

type ChapterProps = Page.Props<typeof Chapter>;
expectTypeOf<ChapterProps["params"]>().toEqualTypeOf<{
  readonly slug: "routing" | "view-service";
}>();
expectTypeOf<ChapterProps["query"]>().toEqualTypeOf<{
  readonly tab?: string;
}>();

expectTypeOf<Page.Props<typeof About>["params"]>().toEqualTypeOf<{}>();
