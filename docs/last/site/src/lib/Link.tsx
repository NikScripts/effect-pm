/**
 * Soft-nav for {@link Site} — `Router.link(Site)` (Waku is only the location Layer).
 */
"use client";

import * as Router from "last-ts/Router";
import { Site } from "./site";

/** Same module family as {@link Site}: derived Link, not a free generic. */
export const Link = Router.link(Site);
