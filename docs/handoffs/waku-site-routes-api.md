# Docs site — typed routes on Waku (prototype API)

**Status:** prototype on `cursor/view-withsize-types-125f`  
**Code:** `docs/site/src/lib/siteRoutes.ts`, `SiteLink.tsx`, `useSiteRouter.ts`

Waku keeps pages / SSG / SSR / soft-nav. hyperlink `Route` + thin wrappers type the hrefs.

## API

```ts
import { path, urls, site } from "../lib/siteRoutes"
import { SiteLink } from "../components/SiteLink"
import { useSiteRouter } from "../lib/useSiteRouter"

// Static
path.home()                         // "/"
path.releases()                     // "/releases"
path.docs("work-pools")             // `/docs/${string}`  (SSG chapter)

// Dynamic (same builder — Waku file route chooses static vs SSR)
path.apiSymbol("hyperlink-ts", "WorkPool", "Tag")  // own API, SSG
path.apiSymbol("effect", "Effect", "succeed")      // dep API, SSR

// Soft-nav — still Waku Link under the hood
<SiteLink to={(p) => p.docs("work-pools")}>Work pools</SiteLink>
<SiteLink to={path.apiSymbol("effect", "Effect", "succeed")}>succeed</SiteLink>

const router = useSiteRouter()
void router.push((p) => p.releases())

// Catalog UrlBuilder (hover / tests) — same destinations
urls.docs({ params: { chapter: "work-pools" } })
```

`path.*` return types are assignable to Waku `Unstable_InferredPaths` (**no casts**).  
Junk paths like `"/totally-fake"` are **not** assignable to `SitePath`.
