/**
 * Docs-shaped shell on hyperlink-ts Router — nav Links + Outlet.
 * Typed catalog twin (no JSX): `examples/ui/router-mini-docs.ts`.
 */
import * as React from "react";
import * as Router from "../../../src/ui/Router";
import { site, urls } from "./site";

const router = Router.unsafeService(site, "History");

const NavLink = (props: {
  readonly to: string | ((u: typeof urls) => string);
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement => {
  const live = Router.useRouter();
  const href =
    typeof props.to === "function" ? props.to(urls) : props.to;
  const pathOnly = href.split("?")[0] ?? href;
  const current = live.pathname === pathOnly;
  return (
    <Router.Link
      to={href}
      className={[props.className, current ? "is-current" : undefined]
        .filter((x): x is string => x !== undefined && x.length > 0)
        .join(" ") || undefined}
    >
      {props.children}
    </Router.Link>
  );
};

const Chrome = (): React.ReactElement => {
  const live = Router.useRouter();
  return (
    <div className="shell">
      <aside className="nav">
        <NavLink className="brand" to={(u) => u.home()}>
          hyperlink-ts
        </NavLink>
        <h2>Start</h2>
        <ul>
          <li>
            <NavLink to={(u) => u.intro()}>Introduction</NavLink>
          </li>
          <li>
            <NavLink to={(u) => u.install()}>Install</NavLink>
          </li>
        </ul>
        <h2>Guides</h2>
        <ul>
          <li>
            <NavLink to={(u) => u.guides.index()}>Overview</NavLink>
          </li>
          <li>
            <NavLink to={(u) => u.guides.workPools()}>Work pools</NavLink>
          </li>
          <li>
            <NavLink to={(u) => u.guides.gates()}>Gates</NavLink>
          </li>
        </ul>
        <h2>API</h2>
        <ul>
          <li>
            <NavLink to={(u) => u.api("Route")}>Route</NavLink>
          </li>
          <li>
            <NavLink to={(u) => u.api("Router")}>Router</NavLink>
          </li>
        </ul>
      </aside>
      <main className="main">
        <div className="crumb">{live.href || "/"}</div>
        <Router.Outlet />
        {live.match === undefined ? (
          <p className="empty">No match — pick a page in the nav.</p>
        ) : null}
      </main>
    </div>
  );
};

export const App = (): React.ReactElement => {
  React.useEffect(() => {
    if (router.pathname === "/" || router.pathname === "") {
      router.to((u) => u.home(), { replace: true });
    }
  }, []);

  return (
    <Router.Provider value={router}>
      <Chrome />
    </Router.Provider>
  );
};
