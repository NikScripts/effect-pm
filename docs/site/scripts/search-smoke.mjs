import { chromium, devices } from "playwright";

// Run against a live server:  node scripts/search-smoke.mjs [baseUrl]
const base = process.argv[2] ?? "http://localhost:5190";
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exit(1);
};

const browser = await chromium.launch();

// --- Desktop: typeahead panel in the nav ---
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });

  const input = page.locator('.sidebar-search input[type="search"]');
  await input.waitFor({ timeout: 15000 });
  await input.fill("subscribable");

  const panel = page.locator(".search-panel");
  await panel.waitFor({ timeout: 15000 });
  const heads = await panel.locator(".search-section-head span").allTextContents();
  if (!heads.includes("API Reference")) fail(`typeahead sections: ${heads.join(", ")}`);
  const firstHit = await panel.locator(".search-hit .search-hit-title").first().textContent();
  if (!firstHit.includes("Resource.Subscribable"))
    fail(`typeahead top hit for subscribable: ${firstHit}`);
  const href = await panel.locator(".search-hit").first().getAttribute("href");
  console.log("typeahead top:", firstHit.trim(), "->", href);

  // matched terms are highlighted
  const marks = await panel.locator(".search-hit mark").count();
  if (marks === 0) fail("no <mark> highlights in typeahead hits");

  // ↓ selects the first hit; Enter navigates TO it (not to /search)
  await input.press("ArrowDown");
  const activeHref = await panel.locator(".search-hit.is-active").getAttribute("href");
  if (activeHref !== href) fail(`ArrowDown selected ${activeHref}, expected ${href}`);
  await input.press("Enter");
  await page.waitForURL(`**${href}`, { timeout: 15000 });
  console.log("keyboard nav: ArrowDown+Enter ->", page.url().replace(base, ""));

  // back to the panel for the Enter → full page path
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await input.waitFor({ timeout: 15000 });
  await input.fill("subscribable");
  await panel.locator(".search-hit").first().waitFor({ timeout: 15000 });

  // Enter with no selection → the full page
  await input.press("Enter");
  await page.waitForURL("**/search?q=subscribable", { timeout: 15000 });
  await page.locator(".search-page .search-section").first().waitFor({ timeout: 15000 });
  const pageTop = await page
    .locator(".search-page .search-hit .search-hit-title")
    .first()
    .textContent();
  if (!pageTop.includes("Resource.Subscribable")) fail(`/search top hit: ${pageTop}`);
  console.log("full page top:", pageTop.trim());

  // "show all" narrows to one section with type param
  await page.locator('.search-section-head a[href*="type=api"]').first().click();
  await page.waitForURL("**/search?q=subscribable&type=api", { timeout: 15000 });
  await page.locator(".search-page .search-hit").first().waitFor({ timeout: 15000 });
  const apiOnly = await page.locator(".search-page .search-section").count();
  if (apiOnly !== 1) fail(`type=api should show 1 section, got ${apiOnly}`);
  console.log("type=api narrowed OK");

  if (errors.length > 0) fail(`desktop page errors: ${errors.join(" | ")}`);
  await page.close();
}

// --- Direct URL load (shareable link) ---
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/search?q=ref`, { waitUntil: "networkidle" });
  await page.locator(".search-page .search-hit").first().waitFor({ timeout: 15000 });
  const top = await page
    .locator(".search-page .search-hit .search-hit-title")
    .first()
    .textContent();
  if (!top.includes("Resource.ref")) fail(`/search?q=ref top: ${top}`);
  console.log("direct /search?q=ref top:", top.trim());
  const glossary = await page.locator(".search-section-head span").allTextContents();
  console.log("sections on ref page:", glossary.join(", "));
  if (errors.length > 0) fail(`direct-load page errors: ${errors.join(" | ")}`);
  await page.close();
}

// --- iPhone: typeahead usable on touch ---
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  // hamburger opens the nav WITHOUT touching the search field
  const input = page.locator('input[placeholder="Search docs and API…"]').first();
  await page.locator("label.menu-btn").tap();
  await input.waitFor({ timeout: 15000 });
  const stole = await input.evaluate((el) => document.activeElement === el);
  if (stole) fail("hamburger tap must not focus the search input");
  // the search button focuses it even when the overlay is already open
  await page.locator('button[aria-label="Search"]').tap();
  // the tap must land focus synchronously — that's what makes iOS raise the keyboard
  const focused = await input.evaluate((el) => document.activeElement === el);
  if (!focused) fail("search input not focused after tapping the search button");
  await input.fill("queue");
  await page.locator(".search-panel .search-hit").first().waitFor({ timeout: 15000 });
  const hit = await page.locator(".search-panel .search-hit-title").first().textContent();
  console.log("mobile typeahead top for queue:", hit.trim());
  if (errors.length > 0) fail(`mobile page errors: ${errors.join(" | ")}`);
  await ctx.close();
}

await browser.close();
console.log("SEARCH SMOKE PASS");
