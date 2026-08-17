/**
 * Internal impl for {@link ../Route} — HttpApiEndpoint with Page default success.
 */
import * as Context from "effect/Context";
import { dual } from "effect/Function";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import type * as HttpMethod from "effect/unstable/http/HttpMethod";
import { HttpApiEndpoint } from "effect/unstable/httpapi";
import * as pageSuccess from "./pageSuccess";
import type { RequestOptions } from "./routeRequest";

export const TypeId = "~effect/httpapi/HttpApiEndpoint" as const;

/**
 * Pathname template — always absolute.
 * `:name` = one segment; `*name` = rest (may include `/`) — must be last.
 */
export type Path = `/${string}`;

/**
 * Erased destination. Wider than `HttpApiEndpoint.Top` so GET endpoints with
 * `Payload = never` stay assignable while keeping path + phantoms for
 * {@link pageSuccess.PagePropsFromEndpoint}.
 */
export type Constraint = HttpApiEndpoint.Constraint & {
  readonly path: string;
  readonly "~Params": any;
  readonly "~Query": any;
  readonly "~Success": any;
  readonly params?: Schema.Top | undefined;
  readonly query?: Schema.Top | undefined;
  readonly headers?: Schema.Top | undefined;
  readonly success?: ReadonlySet<Schema.Top> | undefined;
  readonly error?: ReadonlySet<Schema.Top> | undefined;
  readonly annotations: Context.Context<never>;
  prefix(prefix: string): Constraint;
  annotate<I, S>(tag: Context.Key<I, S>, value: S): Constraint;
  annotateMerge<I>(context: Context.Context<I>): Constraint;
};

/**
 * Page destination — `HttpApiEndpoint.get` with {@link pageSuccess.Page} success.
 * Params/Query phantoms preserved for {@link pageSuccess.PagePropsFromEndpoint}.
 *
 * The slots mirror what `HttpApiEndpoint.get` actually returns on this Effect
 * version: params/query/headers arrive as `toCodecStringTree` codecs and the
 * success schema as a `toCodecJson` codec — declaring the bare schemas here
 * would type an endpoint the constructor never produces.
 */
export type Route<
  Id extends string = string,
  PathType extends Path = Path,
  Params extends Schema.Top = never,
  Query extends Schema.Top = never,
  Headers extends Schema.Top = never,
> = HttpApiEndpoint.HttpApiEndpoint<
  Id,
  "GET",
  PathType,
  [Params] extends [never] ? never : Schema.toCodecStringTree<Params>,
  [Query] extends [never] ? never : Schema.toCodecStringTree<Query>,
  never,
  [Headers] extends [never] ? never : Schema.toCodecStringTree<Headers>,
  Schema.toCodecJson<pageSuccess.Page>,
  never
>;

export const isRoute = (u: unknown): u is Constraint =>
  HttpApiEndpoint.isHttpApiEndpoint(u);

/**
 * Page destination — dynamic by default (SSR). Same {@link RequestOptions} bag
 * as {@link ../Page.make}. Static mode is owned by Route/Page API — never
 * `getConfig` (see `docs/handoffs/last-ts-api-corrections.md`).
 */
export const get = <
  const Id extends string,
  const PathType extends Path,
  Params extends Schema.Top | Schema.Struct.Fields = never,
  Query extends Schema.Top | Schema.Struct.Fields = never,
  Headers extends Schema.Top | Schema.Struct.Fields = never,
>(
  identifier: Id,
  path: PathType,
  options?: RequestOptions<Params, Query, Headers>,
) => {
  const endpoint = HttpApiEndpoint.get(identifier, path, {
    params: options?.params,
    query: options?.query,
    headers: options?.headers,
    success: pageSuccess.Page,
    // SAFE: forwards the caller-typed error option; the slot constraint (ErrorNoStream)
    // is unexpressible through RequestOptions without re-deriving get's whole generic row.
    error: options?.error as never,
  });
  // SAFE: brand-only intersection on the value get() just returned — no shape change;
  // IsPageEndpoint reads the brand after success codec wraps.
  return endpoint as typeof endpoint & pageSuccess.PageEndpointBrand;
};

export type { RequestOptions } from "./routeRequest";

/**
 * The endpoint type after a params swap — every slot of `E` preserved, the
 * Params slot rebuilt as the `toCodecStringTree` codec `HttpApiEndpoint.get`
 * mints for `S`. Keeping this typed (not erased to {@link Constraint}) is what
 * keeps a catalog's {@link UrlBuilder} / paths literal after `Route.params`.
 */
export type ReParams<E, S extends Schema.Top> = E extends {
  readonly identifier: infer Id extends string;
  readonly method: infer Method extends HttpMethod.HttpMethod;
  readonly path: infer PathType extends string;
  readonly "~Query": infer Query extends Schema.Top;
  readonly "~Payload": infer Payload extends Schema.Top;
  readonly "~Headers": infer Headers extends Schema.Top;
  readonly "~Success": infer Success extends Schema.Top;
  readonly "~Error": infer Err extends Schema.Top;
}
  ? HttpApiEndpoint.HttpApiEndpoint<
      Id,
      Method,
      PathType,
      Schema.toCodecStringTree<S>,
      Query,
      Payload,
      Headers,
      Success,
      Err
    > &
      (E extends pageSuccess.PageEndpointBrand ? pageSuccess.PageEndpointBrand
      : unknown)
  : Constraint;

/**
 * Attach / replace params schema (rebuilds the endpoint — HttpApi has no setter).
 */
export const params: {
  <S extends Schema.Top>(
    schema: S,
  ): <E extends Constraint>(self: E) => ReParams<E, S>;
  <E extends Constraint, S extends Schema.Top>(
    self: E,
    schema: S,
  ): ReParams<E, S>;
} = dual(2, (self: Constraint, schema: Schema.Top): Constraint => {
  const success = Array.from(self.success ?? [pageSuccess.Page]);
  const error = Array.from(self.error ?? []);
  // SAFE: an endpoint path is absolute by construction (get requires `/${string}`);
  // the erased Constraint stores it as string.
  const next = HttpApiEndpoint.get(self.identifier, self.path as Path, {
    params: schema,
    query: self.query,
    headers: self.headers,
    success:
      success.length === 0 ? pageSuccess.Page
      : success.length === 1 ? success[0]!
      : success,
    // SAFE: `error` re-feeds schemas read off the endpoint itself; the option slot's
    // ErrorNoStream constraint is unexpressible for an erased ReadonlySet round-trip.
    error: (error.length === 0 ? undefined
    : error.length === 1 ? error[0]!
    : error) as never,
  });
  // SAFE: a field-for-field rebuild of the same endpoint with one schema swapped — the
  // typed overloads above (ReParams) are the source of truth; the brand survives because
  // the success set is carried over verbatim.
  return next.annotateMerge(
    self.annotations,
  ) as unknown as Constraint & pageSuccess.PageEndpointBrand;
});

/** Join `/a` + `/b` → `/a/b`; `/a` + `/` → `/a`. */
export const joinPath = (prefix: Path | "/", path: Path | "/"): Path => {
  // SAFE (all three): every branch returns a string that starts with "/" by construction;
  // TS cannot carry the template-literal proof through slice/concat.
  if (path === "/") return (prefix === "/" ? "/" : prefix) as Path;
  if (prefix === "/") return path as Path;
  const left = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const right = path.startsWith("/") ? path : `/${path}`;
  return `${left}${right}` as Path;
};

export type CompiledPath = {
  readonly path: string;
  readonly keys: ReadonlyArray<string>;
  readonly build: (params: Record<string, string | undefined>) => string;
  readonly match: (pathname: string) => Option.Option<Record<string, string>>;
};

type PathToken =
  | { readonly _tag: "Lit"; readonly value: string }
  | {
      readonly _tag: "Param";
      readonly key: string;
      readonly optional: boolean;
      readonly slash: string;
    }
  | { readonly _tag: "Splat"; readonly key: string; readonly slash: string };

const paramsRegExp = /(\/?):(\w+)(\?)?/g;

/** Encode a path value; splat values keep `/` (encode each segment). */
const encodePathValue = (value: string, splat: boolean): string =>
  splat
    ? value.split("/").map(encodeURIComponent).join("/")
    : encodeURIComponent(value);

const decodePathValue = (value: string, splat: boolean): string =>
  splat
    ? value.split("/").map(decodeURIComponent).join("/")
    : decodeURIComponent(value);

const tokenize = (source: string): {
  readonly tokens: ReadonlyArray<PathToken>;
  readonly keys: ReadonlyArray<string>;
  readonly splatKeys: ReadonlySet<string>;
} => {
  const tokens: Array<PathToken> = [];
  const keys: Array<string> = [];
  const splatKeys = new Set<string>();
  paramsRegExp.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = paramsRegExp.exec(source)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ _tag: "Lit", value: source.slice(lastIndex, match.index) });
    }
    const [, slash = "/", key, optional] = match;
    keys.push(key!);
    tokens.push({
      _tag: "Param",
      key: key!,
      optional: optional !== undefined,
      slash,
    });
    lastIndex = match.index + match[0].length;
  }
  const remainder = source.slice(lastIndex);
  const splatMatch = /\/\*(\w+)$/.exec(remainder);
  if (splatMatch !== null) {
    const litBefore = remainder.slice(0, splatMatch.index);
    if (litBefore.length > 0) {
      tokens.push({ _tag: "Lit", value: litBefore });
    }
    const key = splatMatch[1]!;
    keys.push(key);
    splatKeys.add(key);
    tokens.push({ _tag: "Splat", key, slash: "/" });
  } else if (remainder.length > 0) {
    tokens.push({ _tag: "Lit", value: remainder });
  }
  return { tokens, keys, splatKeys };
};

export const compilePath = (path: string): CompiledPath => {
  const source = path.startsWith("/") ? path : `/${path}`;
  const { tokens, keys, splatKeys } = tokenize(source);

  let patternSource = "^";
  for (const token of tokens) {
    if (token._tag === "Lit") {
      patternSource += escapeRegex(token.value);
      continue;
    }
    if (token._tag === "Splat") {
      patternSource += `${escapeRegex(token.slash)}(.+)`;
      continue;
    }
    patternSource +=
      token.optional
        ? `(?:${escapeRegex(token.slash)}([^/]+))?`
        : `${escapeRegex(token.slash)}([^/]+)`;
  }
  patternSource += "$";
  const pattern = new RegExp(patternSource, "i");

  const build = (params: Record<string, string | undefined>): string => {
    let out = "";
    for (const token of tokens) {
      if (token._tag === "Lit") {
        out += token.value;
        continue;
      }
      const value = params[token.key];
      if (value === undefined) {
        if (token._tag === "Param" && token.optional) continue;
        throw new Error(`Missing path parameter: ${token.key}`);
      }
      out += `${token.slash}${encodePathValue(value, token._tag === "Splat")}`;
    }
    return out;
  };

  const matchPath = (
    pathname: string,
  ): Option.Option<Record<string, string>> => {
    const normalized = pathname === "" ? "/" : pathname;
    const found = pattern.exec(normalized);
    if (found === null) return Option.none();
    const out: Record<string, string> = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const value = found[i + 1];
      if (value !== undefined) {
        out[key] = decodePathValue(value, splatKeys.has(key));
      }
    }
    return Option.some(out);
  };

  return { path: source, keys, build, match: matchPath };
};

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export { pageSuccess };
