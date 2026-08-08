// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse } from 'waku/router';

// prettier-ignore
import type { getConfig as File_About_getConfig } from './pages/about';
// prettier-ignore
import type { getConfig as File_GuidesSlug_getConfig } from './pages/guides/[slug]';
// prettier-ignore
import type { getConfig as File_Index_getConfig } from './pages/index';
// prettier-ignore
import type { getConfig as File_View_getConfig } from './pages/view';

// prettier-ignore
type Page =
| { path: '/_root'; render: 'static' }
| ({ path: '/about' } & GetConfigResponse<typeof File_About_getConfig>)
| ({ path: '/guides/[slug]' } & GetConfigResponse<typeof File_GuidesSlug_getConfig>)
| ({ path: '/' } & GetConfigResponse<typeof File_Index_getConfig>)
| ({ path: '/view' } & GetConfigResponse<typeof File_View_getConfig>);

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
  }
}
