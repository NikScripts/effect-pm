/**
 * Shared chapter request options — page class + catalog both import this
 * (Provider stays client-safe; no RSC page import into the soft-nav layer).
 */
import { Schema } from "effect";

export const chapterOptions = {
  params: { slug: Schema.Literals(["routing", "view-service"]) },
} as const;

export const chapterBags = [
  { slug: "routing" as const },
  { slug: "view-service" as const },
] as const;
