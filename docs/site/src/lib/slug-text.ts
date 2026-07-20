// Text → URL-slug, ONE copy — heading anchors (Djot's id scheme), glossary keys, and the search
// index's deep links must all agree, so they all import this.
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
