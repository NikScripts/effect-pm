"use client";

/**
 * Children-only app provider — catalog soft-nav over Waku.
 *
 * ```ts
 * export const provider = Last.provider(Waku.fromApi(Site))
 * // <provider>…</provider>
 * ```
 */
import * as Last from "last-ts/Last";
import * as Waku from "last-ts/Waku";
import { Site } from "../lib/site.js";

export const provider = Last.provider(Waku.fromApi(Site));
