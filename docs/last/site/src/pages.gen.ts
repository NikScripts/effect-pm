// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse } from 'waku/router';

// prettier-ignore
import type { getConfig as File_DocsPath_getConfig } from './pages/docs/[...path]';
// prettier-ignore
import type { getConfig as File_GuidesSlug_getConfig } from './pages/guides/[slug]';

// prettier-ignore
type Page =
| { path: '/_root'; render: 'static' }
| { path: '/about'; render: 'static' }
| ({ path: '/docs/[...path]' } & GetConfigResponse<typeof File_DocsPath_getConfig>)
| ({ path: '/guides/[slug]' } & GetConfigResponse<typeof File_GuidesSlug_getConfig>)
| { path: '/'; render: 'static' }
| { path: '/view'; render: 'static' };

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
  }
}
