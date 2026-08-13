/**
 * Soft-nav for {@link Site} — `Waku.link(Site)` beside the catalog (client).
 */
"use client";

import * as Waku from "last-ts/Waku";
import { Site } from "./site";

/** Same module family as {@link Site}: derived Link, not a free generic. */
export const Link = Waku.link(Site);
