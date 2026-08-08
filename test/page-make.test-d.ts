/**
 * Page.make / Page.static — mode brands (no deleted helpers).
 */
import { expectTypeOf } from "vitest";
import * as Page from "last-ts/Page";

class About extends Page.make() {}
class Home extends Page.static() {}

expectTypeOf(About.mode).toEqualTypeOf<"dynamic">();
expectTypeOf(Home.mode).toEqualTypeOf<"static">();
