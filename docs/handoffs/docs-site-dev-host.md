# Docs demo host — `dev.hyperlink.cool`

**Status:** Live (2026-07-28). CF Single Redirects (edge SSOT) + origin
`scripts/serve-production.mjs` (host-gate before Waku `serveStatic`).  
**Decision (owner, 2026-07-28):** Keep advertising off. Brand host is coming-soon;
docs stay available for feedback on a demo host.

| Host | Role |
|------|------|
| `hyperlink.cool` / `www` | Coming-soon lockup only |
| `dev.hyperlink.cool` | Full docs site (`DOCS_SITE_ORIGIN`) |
| `*.ondigitalocean.app` | Origin preview / smokes (ungated) |

## Enforcement (SSOT = Cloudflare Single Redirects)

Waku's Node adapter mounts `serveStatic` **before** Hono middleware, so
`docs/site/src/middleware/00-publicHostGate.ts` alone would miss prerendered HTML.
Production therefore starts via `scripts/serve-production.mjs`, which applies the same
`resolvePublicHostGate` rules **before** Waku (and still allows `/assets/*`). Edge
redirects remain the public SSOT:

Ruleset `90c650374e5d4ce0adc5f4be936ddf46` (`http_request_dynamic_redirect`):

1. **Brand host** — `/docs*`, `/api*`, `/search*`, `/releases*`, `/llms*.txt`,
   `/sitemap.xml` → `302 https://hyperlink.cool/`  
   (Do **not** block `/assets/*` — that shipped unstyled HTML with the full docs nav
   visible on mobile.)
2. **Dev host** — `/` → `302 https://dev.hyperlink.cool/docs/index`

Coming-soon `/` uses a root layout **without** docs chrome; book routes live under
`pages/(book)/` so nav HTML is never on the brand page.

DNS: `dev` CNAME → `hyperlink-docs-ekhme.ondigitalocean.app` (proxied).  
Cache Rules host expr → `dev.hyperlink.cool` (`pnpm run cf:ensure`).

## Verify

```sh
curl -sSI https://hyperlink.cool/docs/index   # 302 → /
curl -sSI https://dev.hyperlink.cool/         # 302 → /docs/index
curl -sS  https://hyperlink.cool/ | rg 'Coming soon'
pnpm run docs:smoke:routes -- https://dev.hyperlink.cool
```
