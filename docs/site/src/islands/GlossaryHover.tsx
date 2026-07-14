"use client";

// Hover-preview for glossary terms. Any link to `/docs/glossary#<slug>` shows that term's definition in
// a small popup on hover. The term→definition map is passed in from the layout (parsed from the glossary
// page). The popup is appended to <body> and positioned `fixed`, so it escapes any scroll container.
// Mounted once; event delegation covers every glossary link on the page.

import * as React from "react";
import type { GlossaryEntry } from "../lib/docs-content.js";

const MARK = "/docs/glossary#";

const slugOf = (href: string): string | null => {
  const i = href.indexOf(MARK);
  return i >= 0 ? href.slice(i + MARK.length) : null;
};

export function GlossaryHover({
  data,
}: {
  readonly data: Record<string, GlossaryEntry>;
}): null {
  React.useEffect(() => {
    let popup: HTMLDivElement | null = null;
    let closeTimer = 0;

    const cancelClose = (): void => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = 0;
      }
    };
    const hide = (): void => {
      if (popup) popup.style.display = "none";
    };
    const scheduleHide = (): void => {
      cancelClose();
      closeTimer = window.setTimeout(hide, 160);
    };
    const ensure = (): HTMLDivElement => {
      if (!popup) {
        popup = document.createElement("div");
        popup.className = "glossary-popup";
        popup.addEventListener("mouseenter", cancelClose);
        popup.addEventListener("mouseleave", scheduleHide);
        document.body.appendChild(popup);
      }
      return popup;
    };
    const show = (link: Element, entry: GlossaryEntry): void => {
      cancelClose();
      const p = ensure();
      p.innerHTML = "";
      const term = document.createElement("div");
      term.className = "glossary-popup-term";
      term.textContent = entry.term;
      const def = document.createElement("div");
      def.className = "glossary-popup-def";
      def.textContent = entry.def;
      p.append(term, def);
      p.style.display = "block";
      const r = link.getBoundingClientRect();
      p.style.position = "fixed";
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      p.style.left = `${Math.min(Math.max(6, r.left), window.innerWidth - w - 6)}px`;
      p.style.top = r.top - h - 8 >= 0 ? `${r.top - h - 8}px` : `${r.bottom + 8}px`;
    };

    const onOver = (e: MouseEvent): void => {
      const link = (e.target as Element | null)?.closest?.(`a[href*="${MARK}"]`);
      if (!link) return;
      const slug = slugOf(link.getAttribute("href") ?? "");
      const entry = slug ? data[slug] : undefined;
      if (entry) show(link, entry);
    };
    const onOut = (e: MouseEvent): void => {
      if ((e.target as Element | null)?.closest?.(`a[href*="${MARK}"]`)) scheduleHide();
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      cancelClose();
      popup?.remove();
    };
  }, [data]);
  return null;
}
