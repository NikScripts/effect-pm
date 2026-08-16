/**
 * Soft-nav for the site catalog — `Router.link(Catalog)`.
 */
"use client";

import * as Router from "last-ts/Router";
import { Catalog } from "./Catalog";

/** Typesafe soft-nav; Waku is only the location Layer. */
export const Link = Router.link(Catalog);
