"use client";

/**
 * Waku `Link` with typed `to` from {@link ../lib/siteRoutes}.
 *
 * Soft-nav / RSC refetch stay Waku’s. We only type the destination.
 *
 * @example
 * <SiteLink to={(p) => p.docs("work-pools")}>Work pools</SiteLink>
 * <SiteLink to={path.apiSymbol("hyperlink-ts", "Route", "handle")}>Route.handle</SiteLink>
 */
import * as React from "react";
import {
  Link as WakuLink,
  type LinkProps as WakuLinkProps,
} from "waku/router/client";
import { path, type Path, type SitePath } from "../lib/siteRoutes.js";

export type SiteLinkProps = Omit<WakuLinkProps, "to"> & {
  /** Concrete {@link SitePath}, or a builder over {@link path}. */
  readonly to: SitePath | ((p: Path) => SitePath);
};

export function SiteLink(props: SiteLinkProps): React.ReactElement {
  const { to, children, ...rest } = props;
  const href = typeof to === "function" ? to(path) : to;
  return (
    <WakuLink to={href} {...rest}>
      {children}
    </WakuLink>
  );
}
