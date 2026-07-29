// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse } from 'waku/router';

// prettier-ignore
import type { getConfig as File_Book404_getConfig } from './pages/(book)/404';
// prettier-ignore
import type { getConfig as File_BookApiPkgModuleSymbol_getConfig } from './pages/(book)/api/[pkg]/[module]/[symbol]';
// prettier-ignore
import type { getConfig as File_BookApiPkgModuleIndex_getConfig } from './pages/(book)/api/[pkg]/[module]/index';
// prettier-ignore
import type { getConfig as File_BookApiPkgIndex_getConfig } from './pages/(book)/api/[pkg]/index';
// prettier-ignore
import type { getConfig as File_BookApiHyperlinkTsModuleSymbol_getConfig } from './pages/(book)/api/hyperlink-ts/[module]/[symbol]';
// prettier-ignore
import type { getConfig as File_BookApiIndex_getConfig } from './pages/(book)/api/index';
// prettier-ignore
import type { getConfig as File_BookDocsChapter_getConfig } from './pages/(book)/docs/[chapter]';
// prettier-ignore
import type { getConfig as File_BookDocsHyperlinks_getConfig } from './pages/(book)/docs/hyperlinks';
// prettier-ignore
import type { getConfig as File_BookDocsResources_getConfig } from './pages/(book)/docs/resources';
// prettier-ignore
import type { getConfig as File_BookReleases_getConfig } from './pages/(book)/releases';
// prettier-ignore
import type { getConfig as File_Root_getConfig } from './pages/_root';
// prettier-ignore
import type { getConfig as File_Index_getConfig } from './pages/index';

// prettier-ignore
type Page =
| ({ path: '/404' } & GetConfigResponse<typeof File_Book404_getConfig>)
| ({ path: '/api/[pkg]/[module]/[symbol]' } & GetConfigResponse<typeof File_BookApiPkgModuleSymbol_getConfig>)
| ({ path: '/api/[pkg]/[module]' } & GetConfigResponse<typeof File_BookApiPkgModuleIndex_getConfig>)
| ({ path: '/api/[pkg]' } & GetConfigResponse<typeof File_BookApiPkgIndex_getConfig>)
| ({ path: '/api/hyperlink-ts/[module]/[symbol]' } & GetConfigResponse<typeof File_BookApiHyperlinkTsModuleSymbol_getConfig>)
| ({ path: '/api' } & GetConfigResponse<typeof File_BookApiIndex_getConfig>)
| ({ path: '/docs/[chapter]' } & GetConfigResponse<typeof File_BookDocsChapter_getConfig>)
| ({ path: '/docs/hyperlinks' } & GetConfigResponse<typeof File_BookDocsHyperlinks_getConfig>)
| ({ path: '/docs/resources' } & GetConfigResponse<typeof File_BookDocsResources_getConfig>)
| ({ path: '/releases' } & GetConfigResponse<typeof File_BookReleases_getConfig>)
| { path: '/search'; render: 'static' }
| ({ path: '/_root' } & GetConfigResponse<typeof File_Root_getConfig>)
| ({ path: '/' } & GetConfigResponse<typeof File_Index_getConfig>);

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
  }
}
