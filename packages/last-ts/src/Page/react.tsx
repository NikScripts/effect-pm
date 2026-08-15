/**
 * @module Page/react
 *
 * Client-only React bridges for {@link ../Page.Request} (and legacy Outlet
 * document read helpers). RSC pages import from `last-ts/Page` without
 * pulling createContext. Write document fields with {@link ../Page.document}.
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
