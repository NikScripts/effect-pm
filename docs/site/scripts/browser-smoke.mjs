// Browser smoke test for the hover pipeline — the piece no unit test can see: does a tap/hover
// MATERIALIZE the (template-inert) popup with the right content, on a real page, with zero console
// errors. Run against a live dev server:  node scripts/browser-smoke.mjs [baseUrl]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:5190";
const pages = ["/docs/core-concepts", "/api/effect-pm/FleetHealth/rollup"];
let failed = false;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
for (const path of pages) {
await page.goto(base + path, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
const state = await page.evaluate(() => {
  const hovers = document.querySelectorAll(".twoslash-hover");
  const tpls = document.querySelectorAll("template.twoslash-popups");
  let contentPopups = 0, childPopups = 0;
  for (const t of tpls) {
    if (t.content && t.content.childElementCount > 0) contentPopups++;
    else if (t.children.length > 0) childPopups++;
  }
  return { hovers: hovers.length, templates: tpls.length, contentPopups, childPopups,
           livePopups: document.querySelectorAll(".twoslash-popup-container").length };
});
console.log("STATE:", JSON.stringify(state));
// hover the first token
const hover = page.locator(".twoslash-hover").first();
await hover.hover();
await page.waitForTimeout(400);
const after = await page.evaluate(() => {
  const open = document.querySelector(".twoslash-hover.is-open");
  const popup = open?.querySelector(":scope > .twoslash-popup-container");
  const cs = popup ? getComputedStyle(popup) : null;
  return { opened: !!open, materialized: !!popup, display: cs?.display, visibleText: popup?.textContent?.slice(0, 40) };
});
console.log("AFTER HOVER:", JSON.stringify(after));
if (!after.opened || !after.materialized || after.display !== "block" || errors.length > 0) failed = true;
console.log(path, "=>", after.opened && after.materialized && after.display === "block" && errors.length === 0 ? "OK" : "FAIL");
errors.length = 0;
}
console.log(failed ? "SMOKE FAIL" : "SMOKE OK");
await browser.close();
process.exit(failed ? 1 : 0);
