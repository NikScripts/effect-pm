// Browser smoke test for the hover pipeline — the piece no unit test can see: does a hover (desktop)
// and a TAP (touch device) open and MATERIALIZE the template-inert popup with the right content, with
// zero console errors and zero page errors (hydration failures surface here). Also hits module/package
// API canaries so a truncated SSG 404 fails here, not in a human's browser.
// Run against a live server:  node scripts/browser-smoke.mjs [baseUrl]
import { chromium, devices } from "playwright";

const base = process.argv[2] ?? "http://localhost:5190";
// Hover canaries (need twoslash) + route canaries that must not 404 / hydrate-crash.
const hoverPages = ["/docs/core-concepts", "/api/hyperlink-ts/FleetHealth/rollup"];
const routePages = ["/docs/install", "/api/hyperlink-ts/WorkPool", "/api/hyperlink-ts"];
let failed = false;
const browser = await chromium.launch();

const collectErrors = (page) => {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 200)));
  return errors;
};

// Cheap HTTP+hydration canaries — module/package 404s and React #418 surface here.
{
  const page = await browser.newPage();
  const errors = collectErrors(page);
  for (const path of routePages) {
    const res = await page.goto(base + path, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(800);
    const title = await page.title();
    const status = res?.status() ?? 0;
    const hydration = errors.some((e) => /418|hydrat/i.test(e));
    const notFound = status === 404 || /page not found/i.test(title);
    const ok = status === 200 && !notFound && !hydration && errors.length === 0;
    if (!ok) failed = true;
    console.log(
      `route ${path} =>`,
      ok ? "OK" : `FAIL ${JSON.stringify({ status, title, hydration, errors: errors.slice(0, 3) })}`,
    );
    errors.length = 0;
  }
  await page.close();
}

const check = async (ctx, label, interact) => {
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  for (const path of hoverPages) {
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1200);
    await interact(page.locator(".twoslash-hover").first());
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const open = document.querySelector(".twoslash-hover.is-open");
      const popup = open?.querySelector(":scope > .twoslash-popup-container");
      return {
        opened: !!open,
        materialized: !!popup,
        display: popup ? getComputedStyle(popup).display : null,
      };
    });
    const ok = after.opened && after.materialized && after.display === "block" && errors.length === 0;
    if (!ok) failed = true;
    console.log(
      `${label} ${path} =>`,
      ok ? "OK" : `FAIL ${JSON.stringify({ ...after, errors: errors.slice(0, 3) })}`,
    );
    errors.length = 0;
  }
  await page.close();
};

await check(await browser.newContext(), "desktop-hover", (t) => t.hover());
await check(await browser.newContext({ ...devices["iPhone 13"] }), "iphone-tap  ", (t) => t.tap());

console.log(failed ? "SMOKE FAIL" : "SMOKE OK");
await browser.close();
process.exit(failed ? 1 : 0);
