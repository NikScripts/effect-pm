/**
 * Internal impl for {@link ../ui/Route} — UI route declarations (HttpApiEndpoint-shaped,
 * without HTTP methods).
 */
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import { dual } from "effect/Function";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import type * as Schema from "effect/Schema";

export const TypeId = "~last-ts/Route" as const;

/**
 * Pathname template — always absolute.
 * `:name` = one segment; `*name` = rest (may include `/`) — must be last.
 */
export type Path = `/${string}`;

export interface Route<
  out Id extends string = string,
  out PathType extends Path = Path,
  out Params = never,
> extends Pipeable {
  readonly [TypeId]: typeof TypeId;
  readonly identifier: Id;
  readonly path: PathType;
  readonly params: Schema.Top | undefined;
  readonly annotations: Context.Context<never>;
  prefix(prefix: Path): Route<Id, Path, Params>;
  annotate<I, S>(tag: Context.Key<I, S>, value: S): Route<Id, PathType, Params>;
  annotateMerge(context: Context.Context<never>): Route<Id, PathType, Params>;
}

export type Constraint = Route<string, Path, any>;

export const isRoute = (u: unknown): u is Constraint =>
  typeof u === "object" && u !== null && TypeId in u;

const Proto = {
  pipe() {
    // Effect Pipeable protocol — `arguments` is required by `pipeArguments`.
    // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
    return pipeArguments(this, arguments);
  },
  prefix(this: Constraint, prefix: Path) {
    return makeProto({
      identifier: this.identifier,
      path: joinPath(prefix, this.path),
      params: this.params,
      annotations: this.annotations,
    });
  },
  annotate<I, S>(this: Constraint, tag: Context.Key<I, S>, value: S) {
    return makeProto({
      identifier: this.identifier,
      path: this.path,
      params: this.params,
      annotations: Context.add(this.annotations, tag, value),
    });
  },
  annotateMerge(this: Constraint, context: Context.Context<never>) {
    return makeProto({
      identifier: this.identifier,
      path: this.path,
      params: this.params,
      annotations: Context.merge(this.annotations, context),
    });
  },
};

const makeProto = <Id extends string, PathType extends Path, Params>(options: {
  readonly identifier: Id;
  readonly path: PathType;
  readonly params: Schema.Top | undefined;
  readonly annotations: Context.Context<never>;
}): Route<Id, PathType, Params> =>
  Object.assign(Object.create(Proto), {
    [TypeId]: TypeId,
    identifier: options.identifier,
    path: options.path,
    params: options.params,
    annotations: options.annotations,
  }) as Route<Id, PathType, Params>;

/** Single destination — `HttpApiEndpoint.get` analogue. */
export const get = <const Id extends string, const PathType extends Path>(
  identifier: Id,
  path: PathType,
  options?: {
    readonly params?: Schema.Top | undefined;
  },
): Route<Id, PathType> =>
  makeProto({
    identifier,
    path,
    params: options?.params,
    annotations: Context.empty(),
  });

export const params: {
  <Id extends string, PathType extends Path, S extends Schema.Top>(
    schema: S,
  ): (self: Route<Id, PathType>) => Route<Id, PathType, S["Type"]>;
  <Id extends string, PathType extends Path, S extends Schema.Top>(
    self: Route<Id, PathType>,
    schema: S,
  ): Route<Id, PathType, S["Type"]>;
} = dual(
  2,
  <Id extends string, PathType extends Path, S extends Schema.Top>(
    self: Route<Id, PathType>,
    schema: S,
  ): Route<Id, PathType, S["Type"]> =>
    makeProto({
      identifier: self.identifier,
      path: self.path,
      params: schema,
      annotations: self.annotations,
    }),
);

/** Join `/a` + `/b` → `/a/b`; `/a` + `/` → `/a`. */
export const joinPath = (prefix: Path | "/", path: Path | "/"): Path => {
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
