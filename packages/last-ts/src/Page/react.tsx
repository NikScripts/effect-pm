/**
 * @module Page/react
 *
 * Client-only React bridges for {@link ../Page.Request} / {@link ../Page.Document}.
 * RSC pages import stamps from `last-ts/Page` without pulling createContext.
 *
 * ```ts
 * import { useRequest, useDocument } from "last-ts/Page/react"
 * ```
 */
"use client";

export {
  useRequest,
  useDocument,
  useRequestOption,
  useDocumentApi,
  useDocumentApiOption,
  RequestProvider,
  DocumentRoot,
} from "../internal/pageContext";
