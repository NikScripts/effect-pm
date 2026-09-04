// First-paragraph extraction from raw chapter markdown for meta descriptions. Heuristic on
// purpose: this feeds a <meta> tag, not the page.

const stripInline = (s: string): string =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\{[^}]*\}/g, "")
    .trim();

export const firstParagraphs = (raw: string): string => {
  const paragraphs: Array<string> = [];
  let current: Array<string> = [];
  let inFence = false;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const isProse =
      t !== "" &&
      !t.startsWith("#") &&
      !t.startsWith("{") &&
      !t.startsWith(">") &&
      !t.startsWith(":") &&
      !t.startsWith("|") &&
      !t.startsWith("-");
    if (isProse) {
      current.push(t);
    } else if (current.length > 0) {
      paragraphs.push(stripInline(current.join(" ")));
      current = [];
      // one paragraph is enough once it can stand alone as a description
      if (paragraphs.join(" ").length >= 60) break;
    }
  }
  if (current.length > 0) paragraphs.push(stripInline(current.join(" ")));
  return paragraphs.join(" ").trim();
};
