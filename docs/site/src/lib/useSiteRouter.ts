"use client";

/**
 * Waku `useRouter` with typed `push` / `replace` over {@link path}.
 *
 * @example
 * const router = useSiteRouter()
 * void router.push((p) => p.docs("work-pools"))
 * void router.push(path.apiSymbol("effect", "Effect", "succeed"))
 */
import {
  useRouter as useWakuRouter,
} from "waku/router/client";
import { path, type Path, type SitePath } from "./siteRoutes.js";

export type SiteTo = SitePath | ((p: Path) => SitePath);

const resolve = (to: SiteTo): SitePath =>
  typeof to === "function" ? to(path) : to;

export function useSiteRouter(): {
  readonly path: string;
  readonly query: string;
  readonly hash: string;
  readonly push: (
    to: SiteTo,
    options?: { readonly scroll?: boolean },
  ) => Promise<void>;
  readonly replace: (
    to: SiteTo,
    options?: { readonly scroll?: boolean },
  ) => Promise<void>;
  readonly back: () => void;
  readonly prefetch: (to: SiteTo) => void;
  readonly reload: () => Promise<void>;
} {
  const waku = useWakuRouter();
  return {
    path: waku.path,
    query: waku.query,
    hash: waku.hash,
    push: (to, options) => waku.push(resolve(to), options),
    replace: (to, options) => waku.replace(resolve(to), options),
    back: () => waku.back(),
    prefetch: (to) => waku.prefetch(resolve(to)),
    reload: () => waku.reload(),
  };
}
