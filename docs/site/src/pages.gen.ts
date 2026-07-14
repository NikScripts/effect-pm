// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse } from 'waku/router';

// prettier-ignore
import type { getConfig as File_ApiNamespace_getConfig } from './pages/api/[namespace]';
// prettier-ignore
import type { getConfig as File_ApiIndex_getConfig } from './pages/api/index';
// prettier-ignore
import type { getConfig as File_DocsChapter_getConfig } from './pages/docs/[chapter]';
// prettier-ignore
import type { getConfig as File_Index_getConfig } from './pages/index';

// prettier-ignore
type Page =
| ({ path: '/api/[namespace]' } & GetConfigResponse<typeof File_ApiNamespace_getConfig>)
| ({ path: '/api' } & GetConfigResponse<typeof File_ApiIndex_getConfig>)
| ({ path: '/docs/[chapter]' } & GetConfigResponse<typeof File_DocsChapter_getConfig>)
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
