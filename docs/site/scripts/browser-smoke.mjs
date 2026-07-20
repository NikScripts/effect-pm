// Browser smoke test for the hover pipeline — the piece no unit test can see: does a hover (desktop)
// and a TAP (touch device) open and MATERIALIZE the template-inert popup with the right content, with
// zero console errors and zero page errors (hydration failures surface here). Run against a live dev
// server:  node scripts/browser-smoke.mjs [baseUrl]
import { chromium, devices } from "playwright";

const base = process.argv[2] ?? "http://localhost:5190";
const pages = ["/docs/core-concepts", "/api/effect-pm/FleetHealth/rollup"];
let failed = false;
const browser = await chromium.launch();

const check = async (ctx, label, interact) => {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 200)));
  for (const path of pages) {
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1200);
    await interact(page.locator(".twoslash-hover").first());
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const open = document.querySelector(".twoslash-hover.is-open");
      const popup = open?.querySelector(":scope > .twoslash-popup-container");
      return { opened: !!open, materialized: !!popup,
               display: popup ? getComputedStyle(popup).display : null };
    });
    const ok = after.opened && after.materialized && after.display === "block" && errors.length === 0;
    if (!ok) failed = true;
    console.log(`${label} ${path} =>`, ok ? "OK" : `FAIL ${JSON.stringify({ ...after, errors: errors.slice(0, 3) })}`);
    errors.length = 0;
  }
  await page.close();
};

await check(await browser.newContext(), "desktop-hover", (t) => t.hover());
await check(await browser.newContext({ ...devices["iPhone 13"] }), "iphone-tap  ", (t) => t.tap());

console.log(failed ? "SMOKE FAIL" : "SMOKE OK");
await browser.close();
process.exit(failed ? 1 : 0);
