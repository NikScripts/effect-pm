/**
 * last.ts demo shell — History + RouterBuilder + Link / Outlet.
 */
import * as React from "react";
import * as Router from "last-ts/Router";
import { provider, urls } from "./site";

const NavLink = (props: {
  readonly to: string | ((u: typeof urls) => string);
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const live = Router.useRouter();
  const href = typeof props.to === "function" ? props.to(urls) : props.to;
  const pathOnly = href.split("?")[0] ?? href;
  const current = live.pathname === pathOnly;
  return (
    <Router.Link to={href} className={current ? "is-current" : undefined}>
      {props.children}
    </Router.Link>
  );
};

const Chrome = (): React.ReactElement => {
  const live = Router.useRouter();
  return (
    <div className="shell">
      <aside className="nav">
        <NavLink to={(u) => u.home()}>
          <span className="brand">last.ts</span>
        </NavLink>
        <h2>Demo</h2>
        <ul>
          <li>
            <NavLink to={(u) => u.home()}>Home · Effect page</NavLink>
          </li>
          <li>
            <NavLink to={(u) => u.view()}>View.Service</NavLink>
          </li>
          <li>
            <NavLink to={(u) => u.about()}>About · JSX</NavLink>
          </li>
          <li>
            <NavLink to={(u) => u.chapter("routing")}>
              Guide · params
            </NavLink>
          </li>
        </ul>
        <h2>Imports</h2>
        <ul className="imports">
          <li>
            <code>last-ts/Router</code>
          </li>
          <li>
            <code>last-ts/RouterBuilder</code>
          </li>
          <li>
            <code>last-ts/Page</code>
          </li>
          <li>
            <code>last-ts/View</code>
          </li>
          <li>
            <code>last-ts/History</code>
          </li>
        </ul>
      </aside>
      <main className="main">
        <div className="crumb">{live.href || "/"}</div>
        <Router.Outlet />
      </main>
    </div>
  );
};

const Provider = provider;

export const App = (): React.ReactElement => (
  <Provider>
    <Chrome />
  </Provider>
);
