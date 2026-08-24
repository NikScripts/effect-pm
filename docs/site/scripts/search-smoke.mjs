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

  await page.locator(".search-trigger").click();
  const input = page.locator('.search-modal input[type="search"]');
  await input.waitFor({ timeout: 15000 });
  await input.fill("subscribable");

  const panel = page.locator(".search-modal .search-panel");
  await panel.waitFor({ timeout: 15000 });
  const heads = await panel.locator(".search-section-head span").allTextContents();
  if (!heads.includes("API Reference")) fail(`typeahead sections: ${heads.join(", ")}`);
  const firstHit = await panel.locator(".search-hit .search-hit-title").first().textContent();
  if (!firstHit.includes("Hyperlink.Subscribable"))
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
  await page.locator(".search-trigger").click();
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
  if (!pageTop.includes("Hyperlink.Subscribable")) fail(`/search top hit: ${pageTop}`);
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
  if (!top.includes("Hyperlink.ref")) fail(`/search?q=ref top: ${top}`);
  console.log("direct /search?q=ref top:", top.trim());
  const glossary = await page.locator(".search-section-head span").allTextContents();
  console.log("sections on ref page:", glossary.join(", "));
  if (errors.length > 0) fail(`direct-load page errors: ${errors.join(" | ")}`);
  await page.close();
}

// --- Desktop: ⌘K shortcut, copy button, 404 ---
{
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${base}/docs/core-concepts`, { waitUntil: "networkidle" });
  // ⌘K opens the spotlight modal with the input focused; Escape closes it
  await page.keyboard.press("Meta+KeyK");
  const modalInput = page.locator('.search-modal input[type="search"]');
  await modalInput.waitFor({ timeout: 15000 });
  const focused = await modalInput.evaluate((el) => document.activeElement === el);
  if (!focused) fail("Meta+K did not focus the search modal input");
  await page.keyboard.press("Escape");
  await page.locator(".search-modal").waitFor({ state: "detached", timeout: 5000 });
  console.log("cmd-k opens spotlight modal; esc closes");

  // API pages get the portaled copy button (guide .code-block pres render theirs server-side)
  await page.goto(`${base}/api/hyperlink-ts/Hyperlink/ref`, { waitUntil: "networkidle" });
  const pre = page
    .locator("main pre")
    .filter({ has: page.locator(".copy-btn") })
    .first();
  await pre.waitFor({ timeout: 15000 });
  await pre.hover();
  const btn = pre.locator(".copy-btn");
  await btn.click();
  await page.locator(".copy-btn[data-copied]").waitFor({ timeout: 5000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (clip.trim() === "") fail("copy button copied nothing");
  console.log("api copy button ok:", JSON.stringify(clip.slice(0, 40)));

  // module pages render grouped sections with a jump TOC; a chip navigates to its section
  await page.goto(`${base}/api/effect/Effect`, { waitUntil: "networkidle" });
  await page.locator(".api-group-toc").waitFor({ timeout: 15000 });
  const firstChip = page.locator(".api-group-toc a").first();
  const chipLabel = (await firstChip.textContent()) ?? "";
  await firstChip.click();
  const anchored = await page.evaluate(() => window.location.hash !== "");
  if (!anchored) fail("group TOC chip did not navigate to its anchor");
  const heading = await page.locator(`${await firstChip.getAttribute("href")}`).count();
  if (heading === 0) fail(`group anchor target missing for chip ${chipLabel}`);
  console.log("module groups ok, first chip:", chipLabel.trim());

  // 404 page seeds a search from the dead path
  await page.goto(`${base}/guides/subscribable-nope`, { waitUntil: "networkidle" });
  const nf = page.locator(".notfound");
  await nf.waitFor({ timeout: 15000 });
  await page.locator(".notfound .search-hit").first().waitFor({ timeout: 15000 });
  const nfTop = await page.locator(".notfound .search-hit-title").first().textContent();
  console.log("404 suggestion top:", nfTop.trim());
  if (errors.length > 0) fail(`shortcut/copy/404 page errors: ${errors.join(" | ")}`);
  await ctx.close();
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
