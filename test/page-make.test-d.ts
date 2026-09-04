/**
 * Page.make / Page.static / Route.static — mode brands.
 */
import { Effect } from "effect";
import { expectTypeOf } from "vitest";
import * as React from "react";
import * as Page from "last-ts/Page";
import * as Route from "last-ts/Route";

class About extends Page.make(
  Effect.succeed(React.createElement("h1", null, "About")),
) {}
class Home extends Page.static(React.createElement("h1", null, "Home")) {}

expectTypeOf(About.mode).toEqualTypeOf<"dynamic">();
expectTypeOf(Home.mode).toEqualTypeOf<"static">();

const aboutStatic = About.pipe(Route.static);
expectTypeOf(aboutStatic.mode).toEqualTypeOf<"static">();
