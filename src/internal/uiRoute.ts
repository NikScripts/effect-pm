/**
 * Internal impl for {@link ../ui/Route} — UI route declarations (HttpApiEndpoint-shaped,
 * without HTTP methods).
 */
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import { dual } from "effect/Function";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import type * as Schema from "effect/Schema";

export const TypeId = "~hyperlink-ts/ui/Route" as const;

/** Pathname template — always absolute (`/health`, `/health/:nodeId`). */
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

const paramsRegExp = /(\/?):(\w+)(\?)?/g;

export const compilePath = (path: string): CompiledPath => {
  const keys: Array<string> = [];
  paramsRegExp.lastIndex = 0;
  let patternSource = "^";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const source = path.startsWith("/") ? path : `/${path}`;
  while ((match = paramsRegExp.exec(source)) !== null) {
    const [whole, slash = "/", key, optional] = match;
    patternSource += escapeRegex(source.slice(lastIndex, match.index));
    keys.push(key!);
    patternSource +=
      optional !== undefined
        ? `(?:${escapeRegex(slash)}([^/]+))?`
        : `${escapeRegex(slash)}([^/]+)`;
    lastIndex = match.index + whole.length;
  }
  patternSource += escapeRegex(source.slice(lastIndex)) + "$";
  const pattern = new RegExp(patternSource, "i");

  const build = (params: Record<string, string | undefined>): string => {
    paramsRegExp.lastIndex = 0;
    return source.replace(
      paramsRegExp,
      (_whole, slash: string, key: string, optional: string | undefined) => {
        const value = params[key];
        if (value === undefined) {
          if (optional !== undefined) return "";
          throw new Error(`Missing path parameter: ${key}`);
        }
        return `${slash}${encodeURIComponent(value)}`;
      },
    );
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
      if (value !== undefined) out[key] = decodeURIComponent(value);
    }
    return Option.some(out);
  };

  return { path: source, keys, build, match: matchPath };
};

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
