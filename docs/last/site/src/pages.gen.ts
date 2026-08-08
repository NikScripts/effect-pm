// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages } from 'waku/router';

// prettier-ignore
type Page =
| { path: '/_root'; render: 'static' }
| { path: '/about'; render: 'static' }
| { path: '/docs/[...path]'; render: 'dynamic' }
| { path: '/guides/[slug]'; render: 'static' }
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
