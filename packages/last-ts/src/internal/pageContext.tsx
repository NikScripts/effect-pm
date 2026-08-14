/**
 * Page React bridges for nested UI under Router.Outlet.
 *
 * @internal
 */
"use client";

import * as React from "react";
import { Effect } from "effect";
import type {
  DocumentApi,
  DocumentValue,
  RequestValue,
} from "./pageServices";

// =============================================================================
// Page.Request bridge
// =============================================================================

const RequestReact = React.createContext<RequestValue | null>(null);

/**
 * Provide Request to descendant React (mirror of the Effect service).
 *
 * @internal
 */
export const RequestProvider = (props: {
  readonly value: RequestValue;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    RequestReact.Provider,
    { value: props.value },
    props.children,
  );

/**
 * Read Request from the React bridge (nested regular components).
 *
 * @public
 */
export const useRequest = (): RequestValue => {
  const value = React.useContext(RequestReact);
  if (value === null) {
    throw new Error(
      "Page.useRequest: render under Router.Outlet (Request provider)",
    );
  }
  return value;
};

/** @internal */
export const useRequestOption = (): RequestValue | null =>
  React.useContext(RequestReact);

// =============================================================================
// Document bridge
// =============================================================================

type DocumentBridge = {
  readonly value: DocumentValue;
  readonly api: DocumentApi;
};

const DocumentReact = React.createContext<DocumentBridge | null>(null);

/**
 * Mutable document bag for one Outlet match — Effect service + React state.
 *
 * @internal
 */
export const useDocumentBag = (): DocumentBridge => {
  const [value, setValue] = React.useState<DocumentValue>({
    title: undefined,
  });
  const latest = React.useRef(value);
  latest.current = value;
  const api = React.useMemo<DocumentApi>(
    () => ({
      set: (title: string) =>
        Effect.sync(() => {
          const next = { title };
          latest.current = next;
          queueMicrotask(() => {
            setValue(next);
          });
        }),
      get: Effect.sync(() => latest.current),
    }),
    [],
  );
  return { api, value };
};

/**
 * Own document state and expose React + Effect bridges to descendants.
 *
 * @internal
 */
export const DocumentRoot = (props: {
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const bridge = useDocumentBag();
  return React.createElement(
    DocumentReact.Provider,
    { value: bridge },
    props.children,
  );
};

/**
 * Read document fields from the React bridge.
 *
 * @public
 */
export const useDocument = (): DocumentValue => {
  const bridge = React.useContext(DocumentReact);
  if (bridge === null) {
    throw new Error(
      "Page.useDocument: render under Router.Outlet (Document provider)",
    );
  }
  return bridge.value;
};

/**
 * Effect Document API from the React bridge (for views under the provider).
 *
 * @internal
 */
export const useDocumentApi = (): DocumentApi => {
  const bridge = React.useContext(DocumentReact);
  if (bridge === null) {
    throw new Error(
      "Page.useDocumentApi: render under Router.Outlet (Document provider)",
    );
  }
  return bridge.api;
};

/** @internal */
export const useDocumentApiOption = (): DocumentApi | null => {
  const bridge = React.useContext(DocumentReact);
  return bridge?.api ?? null;
};
