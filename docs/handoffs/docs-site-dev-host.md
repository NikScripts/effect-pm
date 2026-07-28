# Docs demo host — `dev.hyperlink.cool`

**Status:** Live (2026-07-28). Deploy `c33f1e10a` + CF Single Redirects.  
**Decision (owner, 2026-07-28):** Keep advertising off. Brand host is coming-soon;
docs stay available for feedback on a demo host.

| Host | Role |
|------|------|
| `hyperlink.cool` / `www` | Coming-soon lockup only |
| `dev.hyperlink.cool` | Full docs site (`DOCS_SITE_ORIGIN`) |
| `*.ondigitalocean.app` | Origin preview / smokes (ungated) |

## Enforcement (SSOT = Cloudflare Single Redirects)

Waku serves prerendered HTML **before** Hono middleware, so
`docs/site/src/middleware/00-publicHostGate.ts` does **not** gate static pages in
production. Edge redirects do:

Ruleset `90c650374e5d4ce0adc5f4be936ddf46` (`http_request_dynamic_redirect`):

1. **Brand host** — anything except `/`, `/favicon.svg`, `/og.svg`, `/robots.txt`,
   `/healthz` → `302 https://hyperlink.cool/`
2. **Dev host** — `/` → `302 https://dev.hyperlink.cool/docs/index`

DNS: `dev` CNAME → `hyperlink-docs-ekhme.ondigitalocean.app` (proxied).  
Cache Rules host expr → `dev.hyperlink.cool` (`pnpm run cf:ensure`).

## Verify

```sh
curl -sSI https://hyperlink.cool/docs/index   # 302 → /
curl -sSI https://dev.hyperlink.cool/         # 302 → /docs/index
curl -sS  https://hyperlink.cool/ | rg 'Coming soon'
pnpm run docs:smoke:routes -- https://dev.hyperlink.cool
```
