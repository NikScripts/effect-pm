// THE single `dangerouslySetInnerHTML` boundary — the only file in this app allowed to contain the
// literal (enforced by test/inert-html.test.ts, which counts occurrences across src/).
//
// Why it exists at all: two content shapes cannot ride the normal React-element path —
//   1. Inert popup templates. HTML's parser ALWAYS moves <template> children into `.content`, and
//      React hydration ALWAYS diffs rendered children; those specs cannot agree, so React-rendered
//      template children hydrate as a guaranteed mismatch (React then regenerates the whole
//      multi-MB tree client-side — the dead-taps-on-mobile bug). innerHTML delivery is the one
//      bridge: hydration leaves it alone, and setting it on a template populates `.content`.
//   2. Precomputed hover sidecars (gen-hovers) — finished HTML files we generated at build time.
//
// Safety, in layers:
//   - PROVENANCE BY CONSTRUCTION: the template path accepts only HAST nodes and serializes them
//     itself (src/lib/hast-html.ts, which escapes all text and attribute values) — a caller cannot
//     pass a string. The prerendered path is for OUR generated files and says so in its name.
//   - CONTENT CHECKS: every payload is scanned for markup our pipelines can never produce —
//     script/style/iframe/etc. elements, inline event handlers, javascript: URLs. Patterns match
//     only INSIDE real tags (escaped code text like `onclick=` in a sample cannot open a tag), so
//     code samples cannot false-positive. A hit throws: rendering nothing beats rendering it.

import * as React from "react";
import { hastToHtml } from "./hast-html.js";

// Elements our render pipelines never emit — presence means the content is not ours.
const forbiddenTags = /<\s*(script|style|iframe|object|embed|link|meta|base|form)\b/i;
// An inline event handler INSIDE a tag (escaped text can't open a tag, so `onclick=` in a code
// sample never matches).
const eventHandlerInTag = /<[a-z][^>]*\son\w+\s*=/i;
// A javascript: URL inside a tag's href/src.
const scriptUrlInTag = /<[a-z][^>]*\s(?:href|src)\s*=\s*["']?\s*javascript:/i;

const assertSafe = (html: string, origin: string): string => {
  if (forbiddenTags.test(html) || eventHandlerInTag.test(html) || scriptUrlInTag.test(html)) {
    throw new Error(`inert-html: refusing unsafe markup (origin: ${origin})`);
  }
  return html;
};

// The single dangerous literal, private to this module.
const raw = (tag: string, props: Record<string, unknown>, html: string): React.ReactElement =>
  React.createElement(tag, { ...props, dangerouslySetInnerHTML: { __html: html } });

/**
 * An inert popup `<template>` from HAST children — serialized by OUR serializer (callers cannot
 * pass strings), safety-checked, delivered so hydration leaves it alone and the parser lands it in
 * `template.content`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing
export const inertTemplate = (
  props: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing
  hastChildren: ReadonlyArray<any>
): React.ReactElement =>
  raw("template", props, assertSafe(hastChildren.map(hastToHtml).join(""), "inertTemplate"));

/**
 * A container for HTML WE generated at build time (gen-hovers sidecars) — safety-checked before
 * injection. `origin` names the source for the error message.
 */
export const prerenderedHtml = (
  props: Record<string, unknown>,
  html: string,
  origin: string
): React.ReactElement => raw("div", props, assertSafe(html, origin));
