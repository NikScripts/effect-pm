/**
 * Page.static / .dynamic / .build stamps — file-router marks (no Page.Tag yet).
 */
import { Effect } from "effect";
import { expectTypeOf } from "vitest";
import * as Page from "../src/ui/Page";

const About = Page.static(
  "/about",
  (_props: {}) => null,
  { title: "About" },
);

const Search = Page.dynamic("/search", (_props: {}) => null);

const Chapter = Page.build(
  "/docs/:chapter",
  (_props: { readonly chapter: string }) => null,
  {
    title: "Docs",
    paths: Effect.succeed(["routing"] as const),
  },
);

expectTypeOf(Page.stampOf(About)?.render._tag).toEqualTypeOf<
  "Static" | undefined
>();
expectTypeOf(Page.stampOf(Search)?.render._tag).toEqualTypeOf<
  "Dynamic" | undefined
>();
expectTypeOf(Page.stampOf(Chapter)?.render._tag).toEqualTypeOf<
  "Build" | undefined
>();

expectTypeOf(
  Page.renderModeOf(Page.stampOf(Chapter)!, { dev: true }),
).toEqualTypeOf<"static" | "dynamic">();
