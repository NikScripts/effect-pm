// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse } from 'waku/router';

// prettier-ignore
import type { getConfig as File_404_getConfig } from './pages/404';
// prettier-ignore
import type { getConfig as File_ApiPkgModuleSymbol_getConfig } from './pages/api/[pkg]/[module]/[symbol]';
// prettier-ignore
import type { getConfig as File_ApiPkgModuleIndex_getConfig } from './pages/api/[pkg]/[module]/index';
// prettier-ignore
import type { getConfig as File_ApiPkgIndex_getConfig } from './pages/api/[pkg]/index';
// prettier-ignore
import type { getConfig as File_ApiEffectPmModuleSymbol_getConfig } from './pages/api/effect-pm/[module]/[symbol]';
// prettier-ignore
import type { getConfig as File_ApiIndex_getConfig } from './pages/api/index';
// prettier-ignore
import type { getConfig as File_DocsChapter_getConfig } from './pages/docs/[chapter]';
// prettier-ignore
import type { getConfig as File_Index_getConfig } from './pages/index';
// prettier-ignore
import type { getConfig as File_Releases_getConfig } from './pages/releases';

// prettier-ignore
type Page =
| ({ path: '/404' } & GetConfigResponse<typeof File_404_getConfig>)
| ({ path: '/api/[pkg]/[module]/[symbol]' } & GetConfigResponse<typeof File_ApiPkgModuleSymbol_getConfig>)
| ({ path: '/api/[pkg]/[module]' } & GetConfigResponse<typeof File_ApiPkgModuleIndex_getConfig>)
| ({ path: '/api/[pkg]' } & GetConfigResponse<typeof File_ApiPkgIndex_getConfig>)
| ({ path: '/api/effect-pm/[module]/[symbol]' } & GetConfigResponse<typeof File_ApiEffectPmModuleSymbol_getConfig>)
| ({ path: '/api' } & GetConfigResponse<typeof File_ApiIndex_getConfig>)
| ({ path: '/docs/[chapter]' } & GetConfigResponse<typeof File_DocsChapter_getConfig>)
| ({ path: '/' } & GetConfigResponse<typeof File_Index_getConfig>)
| ({ path: '/releases' } & GetConfigResponse<typeof File_Releases_getConfig>)
| { path: '/search'; render: 'static' };

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
  }
}
