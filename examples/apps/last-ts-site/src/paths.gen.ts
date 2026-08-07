/**
 * Path table for the last.ts RSC demo (hand-maintained until fileRouter
 * Vite hook uses sync Node Path).
 */
export const fileEntries = [
  { id: "index", filePath: "/", routePath: "/" },
  { id: "view", filePath: "/view", routePath: "/view" },
  { id: "about", filePath: "/about", routePath: "/about" },
  {
    id: "guides_slug",
    filePath: "/guides/[slug]",
    routePath: "/guides/:slug",
  },
] as const;
