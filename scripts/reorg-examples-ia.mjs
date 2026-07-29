#!/usr/bin/env node
/**
 * One-shot Examples IA reorg: forms/* → topic folders, clearer names, docs pairs,
 * package scripts, include= paths. Run from repo root: `node scripts/reorg-examples-ia.mjs`
 *
 * Dry-run: DRY=1 node scripts/reorg-examples-ia.mjs
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const dry = process.env.DRY === "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {ReadonlyArray<{ from: string, to: string, slug: string, title: string, run: string, hub: string, lead: string }>} */
const teaching = [
  // work-pool
  {
    from: "examples/forms/queue/workpool-priority-retry.ts",
    to: "examples/work-pool/priority-retry.ts",
    slug: "work-pool-priority-retry",
    title: "WorkPool — priority, dedup, retry",
    run: "example:work-pool-priority-retry",
    hub: "work-pool",
    lead: "Lanes, in-flight dedup, retry budget, and lifecycle events on one WorkPool Tag.",
  },
  {
    from: "examples/forms/queue/workpool-priority-lanes.ts",
    to: "examples/work-pool/named-lanes.ts",
    slug: "work-pool-named-lanes",
    title: "WorkPool — named lanes",
    run: "example:work-pool-named-lanes",
    hub: "work-pool",
    lead: "`WorkPool.priority` with named lanes and weighted take.",
  },
  // daemon
  {
    from: "examples/forms/daemon-store/daemon-layer-store-auto-write.ts",
    to: "examples/daemon/store-auto-write.ts",
    slug: "daemon-store-auto-write",
    title: "Daemon — Soft store auto-write",
    run: "example:daemon-store-auto-write",
    hub: "daemon",
    lead: "`Daemon.layer` + `Daemon.store(tag)` Soft journals on terminal ticks.",
  },
  {
    from: "examples/forms/daemon-store/daemon-layer-typed-error-store.ts",
    to: "examples/daemon/typed-failed-error.ts",
    slug: "daemon-typed-failed-error",
    title: "Daemon — typed Failed.error",
    run: "example:daemon-typed-failed-error",
    hub: "daemon",
    lead: "Tag `error` schema → typed `Failed.error` rows via `Daemon.store`.",
  },
  // gate
  {
    from: "examples/forms/hyperlink/gate-unit-and-input.ts",
    to: "examples/gate/unit-and-input.ts",
    slug: "gate-unit-and-input",
    title: "Gate — unit + input",
    run: "example:gate-unit-and-input",
    hub: "gate",
    lead: "Void-payload and parameterized Gate.Service with concurrency.",
  },
  {
    from: "examples/forms/hyperlink/gate-rate-limit-fleet.ts",
    to: "examples/gate/rate-limit-fleet.ts",
    slug: "gate-rate-limit-fleet",
    title: "Gate — fleet rate limit",
    run: "example:gate-rate-limit-fleet",
    hub: "gate",
    lead: "Two Gates share one RateLimiterStore (Redis or memory).",
  },
  {
    from: "examples/forms/hyperlink/gate-store-readback.ts",
    to: "examples/gate/store-readback.ts",
    slug: "gate-store-readback",
    title: "Gate — store readback",
    run: "example:gate-store-readback",
    hub: "gate",
    lead: "`Gate.store` facts and state history after `gate.run`.",
  },
  {
    from: "examples/forms/hyperlink/gate-runtime-observer.ts",
    to: "examples/gate/runtime-observer.ts",
    slug: "gate-runtime-observer",
    title: "Gate — runtime observer",
    run: "example:gate-runtime-observer",
    hub: "gate",
    lead: "Subscribable status / counters on a Gate.Service handle.",
  },
  {
    from: "examples/forms/hyperlink/http-client-gate.ts",
    to: "examples/gate/http-client.ts",
    slug: "gate-http-client",
    title: "Gate — HttpClientGate",
    run: "example:gate-http-client",
    hub: "gate",
    lead: "`HttpClientGate.transformClient` concurrency on fetch.",
  },
  {
    from: "examples/forms/hyperlink/gate-http-api-client.ts",
    to: "examples/gate/http-api-client.ts",
    slug: "gate-http-api-client",
    title: "Gate — HttpApiClient",
    run: "example:gate-http-api-client",
    hub: "gate",
    lead: "`Gate.HttpApiClient` Tag + nest `metrics.usage`.",
  },
  {
    from: "examples/forms/hyperlink/gate-http-api-layer-effect.ts",
    to: "examples/gate/http-api-layer.ts",
    slug: "gate-http-api-layer",
    title: "Gate — httpApiClientLayer + capture",
    run: "example:gate-http-api-layer",
    hub: "gate",
    lead: "`Gate.httpApiClientLayer` on an existing client Layer with capture.",
  },
  // node
  {
    from: "examples/forms/hyperlink/node-tag-addressed.ts",
    to: "examples/node/tag-addressed.ts",
    slug: "node-tag-addressed",
    title: "Node — Tag with address",
    run: "example:node-tag-addressed",
    hub: "node",
    lead: "`Node.Tag` with fixed `{ path }` IpcSocket.",
  },
  {
    from: "examples/forms/hyperlink/node-tag-bound.ts",
    to: "examples/node/tag-bound.ts",
    slug: "node-tag-bound",
    title: "Node — Tag-bound serve",
    run: "example:node-tag-bound",
    hub: "node",
    lead: "`Hyperlink.andNode` — tag carries the node.",
  },
  {
    from: "examples/forms/hyperlink/node-clients.ts",
    to: "examples/node/clients.ts",
    slug: "node-clients",
    title: "Node — clients catalog",
    run: "example:node-clients",
    hub: "node",
    lead: "`Node.clients` dials multiple services without repeating connect.",
  },
  {
    from: "examples/forms/hyperlink/node-tag-addressless-serve.ts",
    to: "examples/node/addressless-serve.ts",
    slug: "node-addressless-serve",
    title: "Node — addressless serve",
    run: "example:node-addressless-serve",
    hub: "node",
    lead: "Address-less Tag serve — Lookup piped; pair with call.",
  },
  {
    from: "examples/forms/hyperlink/node-tag-addressless-call.ts",
    to: "examples/node/addressless-call.ts",
    slug: "node-addressless-call",
    title: "Node — addressless call",
    run: "example:node-addressless-call",
    hub: "node",
    lead: "Address-less call terminal (`LOOKUP_SOCK`).",
  },
  {
    from: "examples/forms/hyperlink/node-nameless-listen-serve.ts",
    to: "examples/node/nameless-unix-serve.ts",
    slug: "node-nameless-unix-serve",
    title: "Node — nameless unix serve",
    run: "example:node-nameless-unix-serve",
    hub: "node",
    lead: "Nameless `Node.unix([serve…])` — Lookup Soft-baked.",
  },
  {
    from: "examples/forms/hyperlink/node-nameless-listen-call.ts",
    to: "examples/node/nameless-unix-call.ts",
    slug: "node-nameless-unix-call",
    title: "Node — nameless unix call",
    run: "example:node-nameless-unix-call",
    hub: "node",
    lead: "Second process for nameless unix listen.",
  },
  {
    from: "examples/forms/hyperlink/node-nameless-listen-demo.ts",
    to: "examples/node/nameless-unix-demo.ts",
    slug: "node-nameless-unix-demo",
    title: "Node — nameless unix demo",
    run: "example:node-nameless-unix-demo",
    hub: "node",
    lead: "Forks serve then call in one command.",
  },
  {
    from: "examples/forms/hyperlink/node-http-nameless-serve.ts",
    to: "examples/node/nameless-http-serve.ts",
    slug: "node-nameless-http-serve",
    title: "Node — nameless HTTP serve",
    run: "example:node-nameless-http-serve",
    hub: "node",
    lead: "Nameless `Node.http(serve)` — holds until interrupt.",
  },
  {
    from: "examples/forms/hyperlink/node-ws-nameless-serve.ts",
    to: "examples/node/nameless-ws-serve.ts",
    slug: "node-nameless-ws-serve",
    title: "Node — nameless WebSocket serve",
    run: "example:node-nameless-ws-serve",
    hub: "node",
    lead: "Nameless `Node.ws(serve)` — holds until interrupt.",
  },
  {
    from: "examples/forms/hyperlink/node-prototype.ts",
    to: "examples/node/prototype.ts",
    slug: "node-prototype",
    title: "Node — Prototype",
    run: "example:node-prototype",
    hub: "node",
    lead: "`Node.Prototype.make` + `.listen(serves)`.",
  },
  {
    from: "examples/forms/hyperlink/node-lookup.ts",
    to: "examples/node/as-lookup.ts",
    slug: "node-as-lookup",
    title: "Node — asLookup",
    run: "example:node-as-lookup",
    hub: "node",
    lead: "`Node.asLookup` + `Lookup.layerNode` / client.",
  },
  {
    from: "examples/forms/hyperlink/node-identity-coordinator.ts",
    to: "examples/node/identity-coordinator.ts",
    slug: "node-identity-coordinator",
    title: "Node — identity coordinator",
    run: "example:node-identity-coordinator",
    hub: "node",
    lead: "Router + Workers + Lookup placement advice.",
  },
  {
    from: "examples/forms/hyperlink/node-verify-connection.ts",
    to: "examples/node/verify-connection.ts",
    slug: "node-verify-connection",
    title: "Node — verifyConnection",
    run: "example:node-verify-connection",
    hub: "node",
    lead: "Tier-1 reachability and deep `node.status` checks.",
  },
  // fleet
  {
    from: "examples/forms/hyperlink/telemetry-fleet-glass.ts",
    to: "examples/fleet/telemetry-glass.ts",
    slug: "fleet-telemetry-glass",
    title: "Fleet — Telemetry glass",
    run: "example:fleet-telemetry-glass",
    hub: "fleet",
    lead: "Leaf snapshot + fleet in-flight folds via peers.",
  },
  {
    from: "examples/forms/hyperlink/fleet-health-glass.ts",
    to: "examples/fleet/health-glass.ts",
    slug: "fleet-health-glass",
    title: "Fleet — FleetHealth glass",
    run: "example:fleet-health-glass",
    hub: "fleet",
    lead: "Local readiness + fleet byNode / Unreachable peers.",
  },
  {
    from: "examples/forms/hyperlink/shardmap-sessions.ts",
    to: "examples/fleet/shardmap-sessions.ts",
    slug: "fleet-shardmap-sessions",
    title: "Fleet — ShardMap sessions",
    run: "example:fleet-shardmap-sessions",
    hub: "fleet",
    lead: "ShardMap routes get/put across nodes.",
  },
  // launcher
  {
    from: "examples/forms/hyperlink/launcher-lookup-membership.ts",
    to: "examples/launcher/lookup-membership.ts",
    slug: "launcher-lookup-membership",
    title: "Launcher — Lookup membership",
    run: "example:launcher-lookup-membership",
    hub: "launcher",
    lead: "`Launcher.up` then Directory membership verify.",
  },
  {
    from: "examples/forms/hyperlink/launcher-lookup-membership-child.ts",
    to: "examples/launcher/lookup-membership-child.ts",
    slug: "launcher-lookup-membership-child",
    title: "Launcher — membership child",
    run: "example:launcher-lookup-membership",
    hub: "launcher",
    lead: "Child process for the membership demo (spawned by parent).",
  },
  // hyperlink core
  {
    from: "examples/forms/hyperlink/default-defaults.ts",
    to: "examples/hyperlink/tag-defaults.ts",
    slug: "hyperlink-tag-defaults",
    title: "Hyperlink — Tag defaults",
    run: "example:hyperlink-tag-defaults",
    hub: "hyperlink",
    lead: "`Hyperlink.default` / `defaults` — same value local and remote.",
  },
  {
    from: "examples/forms/hyperlink/shared-tag-wire.ts",
    to: "examples/hyperlink/shared-spec-wire.ts",
    slug: "hyperlink-shared-spec-wire",
    title: "Hyperlink — shared Spec wire",
    run: "example:hyperlink-shared-spec-wire",
    hub: "hyperlink",
    lead: "One Spec, many instance keys, routed by per-call key header.",
  },
  // store
  {
    from: "examples/forms/store/store-memory.ts",
    to: "examples/store/memory.ts",
    slug: "store-memory",
    title: "Store — memory",
    run: "example:store-memory",
    hub: "store",
    lead: "In-memory Store.Service Soft journals.",
  },
  {
    from: "examples/forms/store/store-sqlite.ts",
    to: "examples/store/sqlite.ts",
    slug: "store-sqlite",
    title: "Store — SQLite",
    run: "example:store-sqlite",
    hub: "store",
    lead: "SQLite-backed Store.Service Soft journals.",
  },
  // schedule
  {
    from: "examples/forms/schedule/schedule-at.ts",
    to: "examples/schedule/at.ts",
    slug: "schedule-at",
    title: "Schedule — at",
    run: "example:schedule-at",
    hub: "schedule",
    lead: "`Daemon.at` — open-ended schedule entry.",
  },
  {
    from: "examples/forms/schedule/schedule-window.ts",
    to: "examples/schedule/window.ts",
    slug: "schedule-window",
    title: "Schedule — window",
    run: "example:schedule-window",
    hub: "schedule",
    lead: "Armed only inside a closed interval.",
  },
  {
    from: "examples/forms/schedule/schedule-define.ts",
    to: "examples/schedule/define.ts",
    slug: "schedule-define",
    title: "Schedule — define",
    run: "example:schedule-define",
    hub: "schedule",
    lead: "Compose named windows into a schedule bag.",
  },
  {
    from: "examples/forms/schedule/schedule-controls-initializer.ts",
    to: "examples/schedule/controls-initializer.ts",
    slug: "schedule-controls-initializer",
    title: "Schedule — controls (initializer)",
    run: "example:schedule-controls-initializer",
    hub: "schedule",
    lead: "Schedule control surface at layer/initializer time.",
  },
  {
    from: "examples/forms/schedule/schedule-controls-in-effect.ts",
    to: "examples/schedule/controls-in-effect.ts",
    slug: "schedule-controls-in-effect",
    title: "Schedule — controls (in Effect)",
    run: "example:schedule-controls-in-effect",
    hub: "schedule",
    lead: "Mutate schedule entries from inside a running Effect.",
  },
  {
    from: "examples/forms/schedule/schedule-controls-external-fiber.ts",
    to: "examples/schedule/controls-external-fiber.ts",
    slug: "schedule-controls-external-fiber",
    title: "Schedule — controls (external fiber)",
    run: "example:schedule-controls-external-fiber",
    hub: "schedule",
    lead: "Drive schedule controls from an external fiber.",
  },
  // polling
  {
    from: "examples/forms/polling/polling-accelerating.ts",
    to: "examples/polling/accelerating.ts",
    slug: "polling-accelerating",
    title: "Polling — accelerating",
    run: "example:polling-accelerating",
    hub: "polling",
    lead: "Accelerating poll cadence for a Daemon tick body.",
  },
  {
    from: "examples/forms/polling/polling-spaced-read.ts",
    to: "examples/polling/spaced.ts",
    slug: "polling-spaced",
    title: "Polling — spaced",
    run: "example:polling-spaced",
    hub: "polling",
    lead: "`Polling.spaced` — fixed gap between reads.",
  },
  {
    from: "examples/forms/polling/polling-accelerating-reset-cadence.ts",
    to: "examples/polling/accelerating-reset.ts",
    slug: "polling-accelerating-reset",
    title: "Polling — accelerating reset",
    run: "example:polling-accelerating-reset",
    hub: "polling",
    lead: "Accelerating poll with cadence reset on success.",
  },
  {
    from: "examples/forms/polling/polling-accelerating-peek-cadence.ts",
    to: "examples/polling/accelerating-peek.ts",
    slug: "polling-accelerating-peek",
    title: "Polling — accelerating peek",
    run: "example:polling-accelerating-peek",
    hub: "polling",
    lead: "Accelerating poll with peek/cadence observation.",
  },
  {
    from: "examples/forms/polling/schedule-delayed-start.ts",
    to: "examples/polling/delayed-start.ts",
    slug: "polling-delayed-start",
    title: "Polling — delayed start",
    run: "example:polling-delayed-start",
    hub: "polling",
    lead: "Daemon schedule delays the first armed tick.",
  },
  // config
  {
    from: "examples/forms/dynamic-config/dynamic-config-hot-swap.ts",
    to: "examples/config/hot-swap.ts",
    slug: "config-hot-swap",
    title: "Config — hot swap",
    run: "example:config-hot-swap",
    hub: "config",
    lead: "Hot-swap dynamic config into a running layer graph.",
  },
  // scenarios (path tweaks)
  {
    from: "examples/scenarios/multi-protocol-dual-serve.ts",
    to: "examples/scenarios/multi-protocol-dual-serve.ts",
    slug: "scenario-multi-protocol",
    title: "Scenario — multi-protocol dual serve",
    run: "example:scenario-multi-protocol",
    hub: "scenarios",
    lead: "One node served over HTTP and WebSocket; both transports live.",
  },
  {
    from: "examples/scenarios/schedule-sync-from-external-db.ts",
    to: "examples/scenarios/schedule-sync-from-db.ts",
    slug: "scenario-schedule-sync-db",
    title: "Scenario — schedule sync from DB",
    run: "example:scenario-schedule-sync-db",
    hub: "scenarios",
    lead: "DB rows → Daemon schedule entries each tick.",
  },
  {
    from: "examples/serve-per-hyperlink-deps.ts",
    to: "examples/scenarios/serve-per-deps.ts",
    slug: "scenario-serve-per-deps",
    title: "Scenario — serve-per-hyperlink deps",
    run: "example:scenario-serve-per-deps",
    hub: "scenarios",
    lead: "Two HyperServices, different impls of one dependency tag, one /rpc.",
  },
  {
    from: "examples/scenarios/nwslsoccer/gate-http-api-client.ts",
    to: "examples/scenarios/nwslsoccer/gate-http-api-client.ts",
    slug: "scenario-nwsl-http-api",
    title: "Scenario — NWSL Gate.HttpApiClient",
    run: "example:scenario-nwsl-http-api",
    hub: "scenarios",
    lead: "Live NWSL SDP via Gate.HttpApiClient (package modules not 1:1 paired).",
  },
];

/** App directory moves: old → new */
const appMoves = [
  ["examples/hyperlink-tui", "examples/apps/tui"],
  ["examples/hyperlink-web", "examples/apps/web"],
  ["examples/web-dashboard", "examples/apps/dashboard"],
  ["examples/queue-widget", "examples/apps/queue-widget"],
  ["examples/hyperlink-cli", "examples/apps/cli"],
  ["examples/hyperlink-atoms", "examples/apps/atoms"],
  ["examples/view-compose-proto", "examples/apps/view-compose"],
  ["examples/forms/view", "examples/apps/view-scratch"],
];

const depthOf = (rel) => rel.split("/").length - 1; // examples/work-pool/x.ts → 2

const fixImports = (text, fromRel, toRel) => {
  // Rewrite relative imports to src and shared based on new depth.
  // Old forms/*/* were depth 3 (examples/forms/queue/x); new topic/* are depth 2.
  // scenarios were depth 2; nwslsoccer depth 3; serve-per was depth 1.
  const fromDepth = depthOf(fromRel);
  const toDepth = depthOf(toRel);
  if (fromDepth === toDepth && path.dirname(fromRel) === path.dirname(toRel)) {
    return text;
  }
  const up = (n) => Array(n).fill("..").join("/");
  // Heuristic: replace common prefixes
  let out = text;
  const replacements = [
    // forms/topic → topic (depth 3 → 2)
    [/from\s+["']\.\.\/\.\.\/\.\.\/src(\/[^"']*)?["']/g, (_m, sub) => `from "${up(toDepth)}/src${sub ?? ""}"`],
    [/from\s+["']\.\.\/\.\.\/shared(\/[^"']*)?["']/g, (_m, sub) => `from "${up(toDepth)}/shared${sub ?? ""}"`],
    // scenarios root depth 2
    [/from\s+["']\.\.\/\.\.\/src(\/[^"']*)?["']/g, (_m, sub) => `from "${up(toDepth)}/src${sub ?? ""}"`],
    [/from\s+["']\.\.\/shared(\/[^"']*)?["']/g, (_m, sub) => `from "${up(toDepth)}/shared${sub ?? ""}"`],
    // serve-per was examples/*.ts depth 1 → scenarios depth 2
    [/from\s+["']\.\.\/src(\/[^"']*)?["']/g, (_m, sub) => `from "${up(toDepth)}/src${sub ?? ""}"`],
  ];
  // Apply carefully: only when depths changed enough. Simpler approach below per-file.
  void replacements;
  void out;

  // Deterministic: count how many ../ needed for src from `to`
  const srcPrefix = `${up(toDepth)}/src`;
  const sharedPrefix = `${up(toDepth)}/shared`;
  out = text
    .replace(/from\s+["'](?:\.\.\/)+src(\/[^"']*)?["']/g, (_m, sub) => `from "${srcPrefix}${sub ?? ""}"`)
    .replace(/from\s+["'](?:\.\.\/)+shared(\/[^"']*)?["']/g, (_m, sub) => `from "${sharedPrefix}${sub ?? ""}"`);
  return out;
};

const sh = (cmd) => {
  console.log(dry ? `# ${cmd}` : cmd);
  if (!dry) execSync(cmd, { cwd: root, stdio: "inherit" });
};

const write = (rel, body) => {
  const abs = path.join(root, rel);
  console.log(dry ? `# write ${rel}` : `write ${rel}`);
  if (!dry) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
};

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// --- move teaching files ---
for (const t of teaching) {
  if (t.from === t.to) {
    // still may need import fix / docs regen
    continue;
  }
  const fromAbs = path.join(root, t.from);
  if (!fs.existsSync(fromAbs)) {
    console.warn("missing", t.from);
    continue;
  }
  sh(`mkdir -p ${path.dirname(t.to)}`);
  sh(`git mv -f ${t.from} ${t.to}`);
}

// fix imports on all teaching targets
for (const t of teaching) {
  const abs = path.join(root, t.to);
  if (!fs.existsSync(abs) && dry) continue;
  if (!fs.existsSync(abs)) continue;
  let text = read(t.to);
  text = fixImports(text, t.from, t.to);
  // Docs path in module header
  text = text.replace(
    /Docs: `docs\/examples\/[^`]+`/g,
    `Docs: \`docs/examples/${t.hub}/${path.basename(t.to, ".ts")}.md\``,
  );
  // Child launcher path reference
  text = text.replace(
    /launcher-lookup-membership-child\.ts/g,
    "lookup-membership-child.ts",
  );
  text = text.replace(
    /examples\/forms\/hyperlink\/launcher-lookup-membership-child/g,
    "examples/launcher/lookup-membership-child",
  );
  write(t.to, text);
}

// --- app moves ---
for (const [from, to] of appMoves) {
  if (!fs.existsSync(path.join(root, from))) {
    console.warn("skip app move missing", from);
    continue;
  }
  sh(`mkdir -p ${path.dirname(to)}`);
  sh(`git mv -f ${from} ${to}`);
}

// Fix apps imports ../../src → ../../../src (one more level under apps/)
const fixAppSrc = (dir) => {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "components") {
        // still walk components for relative src? unlikely
        fixAppSrc(path.relative(root, p));
        continue;
      }
      fixAppSrc(path.relative(root, p));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(ent.name)) continue;
    let text = fs.readFileSync(p, "utf8");
    const before = text;
    // examples/apps/tui/x → ../../../src
    text = text.replace(
      /from\s+["']\.\.\/\.\.\/src(\/[^"']*)?["']/g,
      (_m, sub) => `from "../../../src${sub ?? ""}"`,
    );
    // already ../../../ might double — only bump once from old ../../
    if (text !== before) {
      write(path.relative(root, p), text);
    }
  }
};
for (const [, to] of appMoves) {
  if (to.startsWith("examples/apps/")) fixAppSrc(to);
}

// --- regenerate docs pairs (delete old docs/examples trees for moved topics) ---
const oldDocDirs = [
  "docs/examples/queue",
  "docs/examples/daemon-store",
  "docs/examples/hyperlink",
  "docs/examples/dynamic-config",
];
for (const d of oldDocDirs) {
  if (fs.existsSync(path.join(root, d))) sh(`git rm -rf ${d}`);
}
// remove old schedule/polling/store/scenarios docs to regenerate
for (const d of ["docs/examples/schedule", "docs/examples/polling", "docs/examples/store", "docs/examples/scenarios"]) {
  if (fs.existsSync(path.join(root, d))) sh(`git rm -rf ${d}`);
}

const processNoErrors = new Set([
  "launcher-lookup-membership-child",
  "hyperlink-shared-spec-wire",
  "node-prototype",
  "node-tag-bound",
  "node-tag-addressed",
  "node-identity-coordinator",
  "node-clients",
  "node-as-lookup",
  "scenario-nwsl-http-api",
]);

for (const t of teaching) {
  const base = path.basename(t.to, ".ts");
  const docRel = `docs/examples/${t.hub}/${base}.md`;
  const noErrors = processNoErrors.has(t.slug);
  const fence = noErrors ? "// @noErrors\n" : "";
  const note = noErrors
    ? "\nFence body `// @noErrors` covers `process` under the docs Twoslash host.\n"
    : "";
  const childNote =
    t.slug === "launcher-lookup-membership-child"
      ? `\n**Run:** spawned by [lookup membership](/docs/launcher-lookup-membership)\n`
      : `**Run:** \`pnpm run ${t.run}\`  \n`;
  const md = `{#${t.slug} title="${t.title}" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/${t.slug}>.
<!-- docs-site-link:end -->
# ${t.title}

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [\`${t.to}\`](https://github.com/nikolasstow/Hyperlink/blob/integration/${t.to})  
${childNote}**Hub:** [Examples → ${t.hub}](/docs/examples#${t.hub})
${note}
## What this shows

${t.lead}

{.twoslash include="${t.to}"}
\`\`\` ts
${fence}\`\`\`
`;
  write(docRel, md);
  if (!dry) sh(`git add ${docRel}`);
}

// --- package.json scripts ---
{
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const scripts = { ...pkg.scripts };

  // Drop old teaching example scripts (we rebuild from the map + composites).
  for (const key of Object.keys(scripts)) {
    if (!key.startsWith("example:")) continue;
    const val = scripts[key];
    if (
      val.includes("examples/forms/") ||
      val.includes("examples/scenarios/") ||
      val.includes("examples/serve-per-hyperlink") ||
      val.includes("examples/hyperlink-tui") ||
      val.includes("examples/hyperlink-web") ||
      val.includes("examples/web-dashboard") ||
      val.includes("examples/queue-widget") ||
      val.includes("examples/hyperlink-cli") ||
      val.includes("examples/view-compose") ||
      key.startsWith("example:form:") ||
      key.startsWith("example:workpool") ||
      key.startsWith("example:daemon-layer") ||
      key.startsWith("example:gate") ||
      key.startsWith("example:node-") ||
      key.startsWith("example:fleet-") ||
      key.startsWith("example:telemetry") ||
      key.startsWith("example:shardmap") ||
      key.startsWith("example:http-client") ||
      key.startsWith("example:default-") ||
      key.startsWith("example:shared-tag") ||
      key.startsWith("example:store-") ||
      key.startsWith("example:launcher") ||
      key.startsWith("example:multi-protocol") ||
      key.startsWith("example:serve-per") ||
      key.startsWith("example:schedule-control") ||
      key.startsWith("example:daemon-") ||
      key.startsWith("example:sports-") ||
      key === "example:nwsl-gate-http-api"
    ) {
      delete scripts[key];
    }
  }

  for (const t of teaching) {
    if (t.slug === "launcher-lookup-membership-child") continue;
    scripts[t.run] = `tsx ${t.to}`;
  }

  // Composites
  scripts["example:schedule-basics"] =
    "pnpm run example:schedule-at && pnpm run example:schedule-window && pnpm run example:schedule-define";
  scripts["example:schedule-controls"] =
    "pnpm run example:schedule-controls-initializer && pnpm run example:schedule-controls-in-effect && pnpm run example:schedule-controls-external-fiber";
  scripts["example:polling-sports"] =
    "pnpm run example:polling-spaced && pnpm run example:polling-accelerating-reset && pnpm run example:polling-accelerating-peek";
  scripts["example:daemon-patterns"] =
    "pnpm run example:polling-accelerating && pnpm run example:polling-delayed-start";

  // Apps (new paths)
  const appScripts = {
    "example:queue-widget": "vite --config examples/apps/queue-widget/vite.config.ts",
    "example:queue-server": "tsx examples/apps/dashboard/queue-server.ts",
    "example:mini-server": "tsx examples/apps/dashboard/mini-server.ts",
    "example:web-dashboard": "vite --config examples/apps/dashboard/vite.config.ts examples/apps/dashboard",
    "example:hyperlink-web": "vite --config examples/apps/web/vite.config.ts examples/apps/web",
    "example:hyperlink-web-server": "tsx examples/apps/web/server.ts",
    "example:view-compose-proto": "vite --config examples/apps/view-compose/vite.config.ts",
    "example:hyperlink-cli": "tsx examples/apps/cli/counter-cli.ts",
    "example:hyperlink-cli-manager": "tsx examples/apps/cli/manager-cli.ts",
    "example:hyperlink-tui":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/counter-tui.tsx",
    "example:hyperlink-tui-grid":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/grid-tui.tsx",
    "example:hyperlink-tui-manager":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/manager-tui.tsx",
    "example:hyperlink":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/hyperlink.tsx",
    "example:group-terminal":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/group-terminal.tsx",
    "example:queue-mock":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/queue-mock.tsx",
    "example:group-grid":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/group-grid-mock.tsx",
    "example:queue-logs":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/queue-logs-mock.tsx",
    "example:dashboard":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/dashboard.tsx",
    "example:dashboard-mock":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/dashboard-mock.tsx",
    "example:queue-live":
      "tsx --tsconfig examples/apps/tui/tsconfig.json examples/apps/tui/queue-live.tsx",
    "example:scenario-nwsl-http-api": "node scripts/nwsl-local.mjs example",
  };
  Object.assign(scripts, appScripts);

  // Aliases for old muscle memory (optional short set)
  scripts["example:schedule-control-basics"] = "pnpm run example:schedule-basics";
  scripts["example:schedule-control-surfaces"] = "pnpm run example:schedule-controls";
  scripts["example:sports-polling-accelerating"] = "pnpm run example:polling-sports";
  scripts["example:daemon-supervisor-patterns"] = "pnpm run example:daemon-patterns";
  scripts["example:nwsl-gate-http-api"] = "pnpm run example:scenario-nwsl-http-api";

  pkg.scripts = scripts;
  write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

// --- hub page ---
{
  const byHub = new Map();
  for (const t of teaching) {
    if (!byHub.has(t.hub)) byHub.set(t.hub, []);
    byHub.get(t.hub).push(t);
  }
  const sectionMeta = [
    ["work-pool", "WorkPool", "/docs/work-pools"],
    ["gate", "Gate", "/docs/gates"],
    ["daemon", "Daemon", "/docs/daemons"],
    ["node", "Node & discovery", "/docs/identity-coordinator"],
    ["fleet", "Fleet", "/docs/telemetry"],
    ["launcher", "Launcher", "/docs/launcher"],
    ["hyperlink", "Hyperlink (Tag & wire)", "/docs/creating-a-hyperlink"],
    ["store", "Store", "/docs/stores"],
    ["schedule", "Schedule", "/docs/daemons"],
    ["polling", "Polling", "/docs/daemons"],
    ["config", "Config", "/docs/configuration"],
    ["scenarios", "Scenarios", null],
  ];
  let body = `{#examples title="Examples" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/examples>.
<!-- docs-site-link:end -->
# Examples

Teaching scripts live under \`examples/<topic>/\` — **same topic names as the guides**.
Each page Twoslash-\`include\`s the real \`.ts\` file. Cuts in that file hide harness noise.

Deep-link a topic: \`#work-pool\`, \`#gate\`, \`#node\`, …

---

`;
  for (const [hub, label, guide] of sectionMeta) {
    const items = byHub.get(hub) ?? [];
    if (items.length === 0) continue;
    body += `## ${label}\n\n`;
    if (guide) body += `Guide: [${label}](${guide})\n\n`;
    for (const t of items) {
      if (t.slug === "launcher-lookup-membership-child") {
        body += `Child of [Lookup membership](/docs/launcher-lookup-membership): \`${t.to}\`\n\n`;
        continue;
      }
      body += `### [${t.title.replace(/^[^—]+—\s*/, "")}](/docs/${t.slug})\n\n`;
      body += `\`${t.to}\` · \`pnpm run ${t.run}\`\n\n`;
    }
    body += `---\n\n`;
  }
  body += `## Apps

Full apps under \`examples/apps/\` (TUI, web, dashboard, CLI, widgets). **Not** 1:1 Twoslash —
see [E5 apps plan](/docs/../handoffs/examples-apps-e5-plan.md) (handoff). Run via \`pnpm run example:hyperlink-tui\`,
\`example:hyperlink-web\`, \`example:web-dashboard\`, …

| App | Path | Start |
|-----|------|-------|
| TUI | \`examples/apps/tui\` | \`pnpm run example:hyperlink-tui\` |
| Web | \`examples/apps/web\` | \`example:hyperlink-web\` + \`example:hyperlink-web-server\` |
| Dashboard | \`examples/apps/dashboard\` | \`example:web-dashboard\` |
| CLI | \`examples/apps/cli\` | \`example:hyperlink-cli\` |
| Queue widget | \`examples/apps/queue-widget\` | \`example:queue-widget\` |
`;
  // Fix handoff link - use relative from docs
  body = body.replace(
    "](/docs/../handoffs/examples-apps-e5-plan.md)",
    "](../handoffs/examples-apps-e5-plan.md)",
  );
  write("docs/examples.md", body);
}

// --- example-sources glob ---
write(
  "docs/site/src/lib/example-sources.ts",
  `// Runnable teaching scripts for \`{.twoslash include="examples/…"}\` fences.
//
// Vite \`?raw\` glob — editing an example HMR-updates the paired doc. Offline checkers
// use \`./example-include.ts\` + disk.

import { normalizeExampleRel } from "./example-include.js";

export {
  normalizeExampleRel,
  prepareExampleForTwoslash,
  rewriteExampleImportsForDocs,
  loadExampleIncludeFromDisk,
} from "./example-include.js";

const modules = import.meta.glob(
  [
    "../../../../examples/work-pool/**/*.ts",
    "../../../../examples/gate/**/*.ts",
    "../../../../examples/daemon/**/*.ts",
    "../../../../examples/node/**/*.ts",
    "../../../../examples/fleet/**/*.ts",
    "../../../../examples/launcher/**/*.ts",
    "../../../../examples/hyperlink/**/*.ts",
    "../../../../examples/store/**/*.ts",
    "../../../../examples/schedule/**/*.ts",
    "../../../../examples/polling/**/*.ts",
    "../../../../examples/config/**/*.ts",
    "../../../../examples/scenarios/**/*.ts",
    "../../../../examples/shared/**/*.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const byRel: ReadonlyMap<string, string> = new Map(
  Object.entries(modules).map(([key, text]) => [normalizeExampleRel(key), text]),
);

export const exampleSource = (rel: string): string | undefined =>
  byRel.get(normalizeExampleRel(rel));
`,
);

// waku watchers
{
  const wakuPath = "docs/site/waku.config.ts";
  let waku = read(wakuPath);
  waku = waku.replace(
    /\/\/ Paired Twoslash includes[\s\S]*?\[\s*\n[\s\S]*?\]\.map/,
    `// Paired Twoslash includes — HMR when teaching scripts change.
        "../../examples/work-pool",
        "../../examples/gate",
        "../../examples/daemon",
        "../../examples/node",
        "../../examples/fleet",
        "../../examples/launcher",
        "../../examples/hyperlink",
        "../../examples/store",
        "../../examples/schedule",
        "../../examples/polling",
        "../../examples/config",
        "../../examples/scenarios",
        "../../examples/shared",
      ].map`,
  );
  write(wakuPath, waku);
}

// clean empty forms dir if present
if (fs.existsSync(path.join(root, "examples/forms"))) {
  sh("rm -rf examples/forms");
}

console.log("reorg complete");
