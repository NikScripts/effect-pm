#!/usr/bin/env node
/**
 * Local-only WIP preview of the brand landing (no deploy).
 * Re-reads landing.css on every request. Binds 0.0.0.0 for Tailscale.
 *
 * Variant bench for the bottom-cutoff hunt:
 *   /?v=a  current landing.css as-is (fixed atmosphere)
 *   /?v=b  fixed atmosphere extended past the viewport bounds (bottom: -18lvh)
 *   /?v=c  document extends under the toolbar: html scrolls by (lvh - dvh),
 *          atmosphere is absolute (document-anchored) so the orb paints into
 *          the under-toolbar band
 *   /?hud=1  overlay: svh/dvh/lvh marker lines + live viewport readout
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = path.join(root, "src/styles/landing.css");

const variants = {
  a: () => "",
  b: (ext) => `
/* B: extend the fixed box past the bounds (tunable: ?ext=N in lvh units).
   Orb re-anchored so its visual spot tracks the viewport, not the overshoot. */
.landing-atmosphere { inset: 0 0 -${ext}lvh 0; }
.landing-glow { inset: auto auto calc(${ext}lvh + 10vh) 62%; }
`,
  c: () => `
/* C: document taller than the dynamic viewport -> content really exists
   under Safari's translucent bar. Scroll range = lvh - dvh; one flick
   collapses the toolbar and the range goes to zero. */
html { overflow-y: auto; overscroll-behavior-y: none; }
body { position: relative; }
.landing-atmosphere {
  position: absolute;
  inset: 0;
  height: 100lvh;
  overflow: hidden; /* clip the orb tail at the physical screen edge, not dvh */
}
`,
  d: () => `
/* D: no-scroll overshoot document — html/body far taller than the screen but
   overflow:hidden (nothing to scroll), atmosphere document-anchored so the
   orb paints into the overshoot via the document surface, not a fixed layer. */
html, body { height: 140lvh; }
body { position: relative; }
.landing-atmosphere {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100lvh;
}
`,
};

/* Paint-floor diagnostic (?stripe=1): two garish rulers extending 100lvh past
   the bottom — left one FIXED, right one ABSOLUTE. Whichever paints deeper on
   the device tells us which positioning scheme to build on. Bands are 10lvh. */
const stripeCss = `
.stripe { top: 0; width: 28px; height: 200lvh; z-index: 8; pointer-events: none;
  background: repeating-linear-gradient(180deg,
    #f0f 0, #f0f 10lvh, #0ff 10lvh, #0ff 20lvh); }
#stripe-fixed { position: fixed; left: 0; }
#stripe-abs { position: absolute; right: 0; }
`;
const stripeHtml = `
<div id="stripe-fixed" class="stripe" aria-hidden="true"></div>
<div id="stripe-abs" class="stripe" aria-hidden="true"></div>
`;

const hudCss = `
body { position: relative; }
.hud-line { position: absolute; left: 0; right: 0; height: 2px; z-index: 9;
  font: 10px/1 monospace; color: #000; padding-left: 4px; }
#hud { position: fixed; top: max(4px, env(safe-area-inset-top)); left: 4px;
  z-index: 9; font: 11px/1.4 monospace; background: #000c; color: #0f0;
  padding: 4px 6px; border-radius: 4px; white-space: pre; }
#hud-probe { position: absolute; visibility: hidden;
  padding-bottom: env(safe-area-inset-bottom, 0px); }
`;

const hudHtml = `
<div class="hud-line" style="top: calc(100svh - 2px); background: #f43">svh</div>
<div class="hud-line" style="top: calc(100dvh - 2px); background: #fa3">dvh</div>
<div class="hud-line" style="top: calc(100lvh - 2px); background: #3f6">lvh</div>
<div id="hud"></div><div id="hud-probe"></div>
<script>
const hud = document.getElementById("hud");
const probe = document.getElementById("hud-probe");
function upd() {
  const vv = window.visualViewport;
  hud.textContent =
    "inner  " + window.innerHeight +
    "\\nvv     " + (vv ? Math.round(vv.height) + " @" + Math.round(vv.offsetTop) : "-") +
    "\\nsafeB  " + probe.offsetHeight +
    "\\nscroll " + Math.round(window.scrollY) + "/" +
      (document.documentElement.scrollHeight - window.innerHeight);
}
upd();
addEventListener("resize", upd);
addEventListener("scroll", upd, { passive: true });
window.visualViewport?.addEventListener("resize", upd);
</script>
`;

/* Look-tuning overrides (?bx=30&by=-12&ox=62&oy=10&glow=44): bloom position,
   orb position, glow alpha. Only emitted for params actually present, so the
   plain URL always shows landing.css exactly as committed. */
function tuneCss(q) {
  const num = (k) => (q.has(k) && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : null);
  const bx = num("bx");
  const by = num("by");
  const ox = num("ox");
  const oy = num("oy");
  const glow = q.get("glow");
  const rules = [];
  if (bx !== null || by !== null) {
    rules.push(`html { background-image:
      radial-gradient(ellipse 160% 70lvh at ${bx ?? 30}% ${by ?? -12}lvh, var(--landing-glow), var(--landing-canvas) 72%),
      radial-gradient(ellipse 100% 55lvh at 100% 110lvh, var(--landing-bg-deep), var(--landing-canvas) 68%),
      radial-gradient(ellipse 90% 50lvh at 0% 110lvh, var(--landing-bg-deep), var(--landing-canvas) 65%); }`);
  }
  if (ox !== null || oy !== null) {
    rules.push(`.landing-glow { inset: auto auto ${oy ?? 10}% ${ox ?? 62}%; }`);
  }
  if (glow && /^[0-9a-f]{2}$/i.test(glow)) {
    rules.push(`:root { --landing-glow: #1496e0${glow}; }
      @media (prefers-color-scheme: dark) { :root { --landing-glow: #4bb8f0${glow}; } }`);
  }
  return rules.join("\n");
}

async function render(v, hud, ext, stripe, tune) {
  const css = await readFile(cssPath, "utf8");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="theme-color" content="#e8f2f7" media="(prefers-color-scheme: light)"/>
<meta name="theme-color" content="#0c1c24" media="(prefers-color-scheme: dark)"/>
<title>Hyperlink landing (WIP ${v}${hud ? "+hud" : ""})</title>
<style>${css}</style>
<style>${(variants[v] ?? variants.a)(ext)}</style>
${tune ? `<style>${tune}</style>` : ""}
${hud ? `<style>${hudCss}</style>` : ""}
${stripe ? `<style>${stripeCss}</style>` : ""}
</head>
<body>
<div class="landing-atmosphere" aria-hidden="true">
  <div class="landing-glow"></div>
</div>
<section class="landing">
  <div class="landing-inner">
    <div class="landing-mark">
      <h1 class="landing-title">Hyperlink</h1>
      <p class="landing-sub">for Effect</p>
    </div>
    <p class="landing-motto">
      <span>Define once.</span> <span>Run anywhere.</span>
      <span class="landing-motto-accent"><code>yield*</code> everywhere.</span>
    </p>
    <p class="landing-lede">
      <span>One Contract. Local or over the network.</span>
      <span>The same typed Handle either way.</span>
    </p>
    <p class="landing-soon">Coming soon</p>
  </div>
</section>
${stripe ? stripeHtml : ""}
${hud ? hudHtml : ""}
</body>
</html>`;
}

const port = Number(process.env.PORT || 5191);
const host = process.env.HOST || "0.0.0.0";

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const v = url.searchParams.get("v") || "a";
    const hud = url.searchParams.get("hud") === "1";
    const ext = Math.min(120, Math.max(0, Number(url.searchParams.get("ext")) || 18));
    const stripe = url.searchParams.get("stripe") === "1";
    const html = await render(variants[v] ? v : "a", hud, ext, stripe, tuneCss(url.searchParams));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(String(err));
  }
}).listen(port, host, () => {
  console.log(`landing WIP preview http://${host}:${port}/ (variants a|b|c, ?hud=1)`);
});
