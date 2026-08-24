/**
 * Footer kit — leaf Views + composition.
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

export class Brand extends View.make<Brand>()(
  "last-ts/site/Footer/Brand",
  () => (
    <div className="footer-brand">
      <span className="footer-name">last.ts</span>
      <p className="footer-tag">Effect + React building blocks</p>
    </div>
  ),
) {}

export class Legal extends View.make<Legal>()(
  "last-ts/site/Footer/Legal",
  () => (
    <p className="footer-legal">
      Official docs for <code>last-ts</code>.
    </p>
  ),
) {}

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/Footer/Root",
  (props) => (
    <footer className="footer">
      <div className="footer-inner">{props.children}</div>
    </footer>
  ),
) {}

export class Footer extends View.make<Footer>()(
  "last-ts/site/Footer",
  () => {
    const {
      Root: FootRoot,
      Brand: BrandView,
      Legal: LegalView,
    } = Last.use(FooterContext);
    return (
      <FootRoot>
        <BrandView />
        <LegalView />
      </FootRoot>
    );
  },
) {}

export class FooterContext extends Last.context({
  Root,
  Brand,
  Legal,
  View: Footer,
}) {}
