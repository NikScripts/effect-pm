/**
 * Named failure modes (one class per mode, carrying its data). These seams are
 * synchronous React / builder code, so the errors are **thrown** — but each is a
 * `Data.TaggedError`, so a caller (or error boundary) can still match by `_tag`
 * and read structured fields instead of parsing a message.
 *
 * @internal
 */
import { Data } from "effect";

/** A url-builder method was called without a required path parameter. @internal */
export class MissingPathParam extends Data.TaggedError("MissingPathParam")<{
  readonly key: string;
}> {
  override get message(): string {
    return `Missing path parameter: ${this.key}`;
  }
}

/** `useRouter` rendered outside `Router.Provider`. @internal */
export class RouterProviderMissing extends Data.TaggedError(
  "RouterProviderMissing",
)<Record<never, never>> {
  override get message(): string {
    return "Router: render inside Router.Provider";
  }
}

/** Waku router read without a Provider mount or default binding. @internal */
export class WakuRouterMissing extends Data.TaggedError(
  "WakuRouterMissing",
)<Record<never, never>> {
  override get message(): string {
    return "Router: provide via Provider (Service or waku binding) or setDefault";
  }
}

/** `useRegistry` rendered outside `<RegistryProvider>`. @internal */
export class RegistryProviderMissing extends Data.TaggedError(
  "RegistryProviderMissing",
)<Record<never, never>> {
  override get message(): string {
    return "AtomReact: render inside <RegistryProvider>";
  }
}

/** `useRuntime` rendered outside `<RuntimeProvider>`. @internal */
export class RuntimeProviderMissing extends Data.TaggedError(
  "RuntimeProviderMissing",
)<Record<never, never>> {
  override get message(): string {
    return "AtomReact.useRuntime: wrap the tree in <RuntimeProvider runtime={…}>";
  }
}

/** `Page.make` received an argument shape none of its overloads declare. @internal */
export class PageMakeArguments extends Data.TaggedError(
  "PageMakeArguments",
)<Record<never, never>> {
  override get message(): string {
    return "Page.make: expected Page.make(default) or Page.make(options, default)";
  }
}

/** `Document.transform` received an argument shape none of its overloads declare. @internal */
export class DocumentTransformArguments extends Data.TaggedError(
  "DocumentTransformArguments",
)<Record<never, never>> {
  override get message(): string {
    return "Document.transform: expected transform(fn) or transform(Doc, fn)";
  }
}

/** `Router.link` rendered with neither `to` nor `out`. @internal */
export class LinkTargetMissing extends Data.TaggedError(
  "LinkTargetMissing",
)<Record<never, never>> {
  override get message(): string {
    return "Router.link: pass to or out";
  }
}

/** Document fields read outside a FieldsProvider. @internal */
export class DocumentFieldsMissing extends Data.TaggedError(
  "DocumentFieldsMissing",
)<Record<never, never>> {
  override get message(): string {
    return "Document: render under Document.FieldsProvider (RootLayout / Last.provider)";
  }
}

/** `Document.provide` fold finished without the required fields. @internal */
export class DocumentTitleMissing extends Data.TaggedError(
  "DocumentTitleMissing",
)<Record<never, never>> {
  override get message(): string {
    return "Document.provide: missing required title (and titleTransform after fold)";
  }
}

/** `Page.useRequest` rendered outside `Router.Outlet`. @internal */
export class PageRequestMissing extends Data.TaggedError(
  "PageRequestMissing",
)<Record<never, never>> {
  override get message(): string {
    return "Page.useRequest: render under Router.Outlet (Request provider)";
  }
}

/** `Page.useDocument` / `useDocumentApi` rendered outside `Router.Outlet`. @internal */
export class PageDocumentMissing extends Data.TaggedError("PageDocumentMissing")<{
  readonly hook: "useDocument" | "useDocumentApi";
}> {
  override get message(): string {
    return `Page.${this.hook}: render under Router.Outlet (Document provider)`;
  }
}

/** The Atom runtime's Context read before it resolved. @internal */
export class RuntimeContextNotReady extends Data.TaggedError(
  "RuntimeContextNotReady",
)<Record<never, never>> {
  override get message(): string {
    return "Last: Atom runtime Context not ready";
  }
}

/** `Last.use` read a context that no mounted provider registered. @internal */
export class ContextNotRegistered extends Data.TaggedError(
  "ContextNotRegistered",
)<Record<never, never>> {
  override get message(): string {
    return "Last.use: context was not registered — mount it via Last.provider(ctx) or a router .context scope on the active path";
  }
}

/** `Last.use` rendered outside `Last.provider` / a router scope. @internal */
export class ContextProviderMissing extends Data.TaggedError(
  "ContextProviderMissing",
)<Record<never, never>> {
  override get message(): string {
    return "Last.use: wrap the tree in Last.provider(layer) (router scopes mount under Outlet)";
  }
}

/** `Last.use` selector resolved a catalog/group without a `.context(…)`. @internal */
export class ContextScopeMissing extends Data.TaggedError("ContextScopeMissing")<{
  readonly subject: string;
}> {
  override get message(): string {
    return this.subject;
  }
}

/** A runtime invariant the type system could not carry was violated. @internal */
export class InvariantViolated extends Data.TaggedError("InvariantViolated")<{
  readonly what: string;
}> {
  override get message(): string {
    return `last-ts invariant violated: ${this.what}`;
  }
}
