# Docs demo host — `dev.hyperlink.cool`

**Status:** Eng'd on tip; waiting on Cloudflare DNS for `dev`.  
**Decision (owner, 2026-07-28):** Keep advertising off. Brand host is coming-soon;
docs stay available for feedback on a demo host.

| Host | Role |
|------|------|
| `hyperlink.cool` / `www` | Coming-soon lockup only (`00-publicHostGate` middleware) |
| `dev.hyperlink.cool` | Full docs site (`DOCS_SITE_ORIGIN`) |
| `*.ondigitalocean.app` | Origin preview / smokes (ungated) |

## Owner action (one DNS record)

Cloudflare → zone `hyperlink.cool` → DNS:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `dev` | `hyperlink-docs-ekhme.ondigitalocean.app` | Proxied (orange cloud) |

The encrypted deploy token can manage Cache Rules but **not** DNS write (API 10000 on
`/dns_records`). Add the record in the dashboard (or widen the token with Zone.DNS Edit).

DigitalOcean already has `dev.hyperlink.cool` as an ALIAS on app `hyperlink-docs`
(`docs/site/deploy/do-app.yaml`).

## After DNS

```sh
cd docs/site
pnpm run cf:ensure          # Cache Rules host expr → dev.hyperlink.cool
pnpm run deploy:do -- hyperlink-docs
```

Expect:

- `https://hyperlink.cool/` → coming soon (no docs CTA / chrome)
- `https://hyperlink.cool/docs/index` → redirect `/`
- `https://dev.hyperlink.cool/` → redirect `/docs/index`
- `https://dev.hyperlink.cool/docs/index` → full book
