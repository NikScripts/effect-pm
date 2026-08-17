// Minimal HAST → HTML serializer (no hast-util-to-html dependency) — ONE shared copy: the
// build-time hover precompute writes sidecar files with it, and the live render serializes inert
// popup-template content with it (delivered via dangerouslySetInnerHTML so React hydration leaves
// the template's parsed content alone).
 

type Hast = any;

const VOID = new Set(["br", "hr", "img", "input", "col", "wbr"]);
const escText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export const hastToHtml = (n: Hast): string => {
  if (n.type === "text") return escText(String(n.value));
  if (n.type === "root") return (n.children ?? []).map(hastToHtml).join("");
  if (n.type !== "element") return "";
  const attrs = Object.entries(n.properties ?? {})
    .map(([k, v]) => {
      const name = k === "className" ? "class" : k;
      const val = Array.isArray(v) ? v.join(" ") : String(v);
      return ` ${name}="${escAttr(val)}"`;
    })
    .join("");
  if (VOID.has(n.tagName)) return `<${n.tagName}${attrs}>`;
  return `<${n.tagName}${attrs}>${(n.children ?? []).map(hastToHtml).join("")}</${n.tagName}>`;
};
