/**
 * Page.Request + Document — Effect services with React bridges for nested UI.
 *
 * @internal
 */
import * as React from "react";
import { Context, Effect } from "effect";

// =============================================================================
// Page.Request
// =============================================================================

/**
 * Matched page request (params/query/pathname/href) — HttpApi `~Request` slice.
 *
 * @public
 */
export type RequestValue = {
  readonly params: Record<string, string>;
  readonly query: Record<string, string>;
  readonly pathname: string;
  readonly href: string;
};

/**
 * Effect service for the current match (`yield* Page.Request`).
 *
 * @public
 */
export class Request extends Context.Service<Request, RequestValue>()(
  "last-ts/Page/Request",
) {}

const RequestReact = React.createContext<RequestValue | null>(null);

/**
 * Provide {@link Request} to descendant React (mirror of the Effect service).
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
 * Read {@link Request} from the React bridge (nested regular components).
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
// Document (title — set anywhere)
// =============================================================================

/**
 * Document chrome bag (title today; extend later).
 *
 * @public
 */
export type DocumentValue = {
  readonly title: string | undefined;
};

/**
 * Effect API for document chrome (`yield* Page.Document`, then `.set`).
 *
 * @public
 */
export type DocumentApi = {
  readonly set: (title: string) => Effect.Effect<void>;
  readonly get: Effect.Effect<DocumentValue>;
};

/**
 * Set-anywhere document chrome (`yield* Page.Document`).
 *
 * @public
 */
export class Document extends Context.Service<Document, DocumentApi>()(
  "last-ts/Page/Document",
) {}

type DocumentBridge = {
  readonly value: DocumentValue;
  readonly api: DocumentApi;
};

const DocumentReact = React.createContext<DocumentBridge | null>(null);

/**
 * Mutable document bag for one Outlet match — Effect service + React state.
 * `set` is deferred so page Effects can run during render without updating
 * React state mid-render.
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
 * Read document chrome from the React bridge.
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
 * Effect {@link Document} API from the React bridge (for baked views).
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
