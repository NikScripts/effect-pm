/**
 * {@link Prototype} — address-less Node template (`.make` / `.instance` / `.listen` → {@link unix}).
 *
 * @internal
 */
import {
  Context,
  Layer,
} from "effect"
import {
  catalogSym,
  ListenNode,
  NamelessListenOptions,
  OnConflict,
  ProtocolKind,
  Tag,
} from "./nodeCore"
import type {
  HttpNodeTagClass,
  IpcNodeTagClass,
  UrlNodeTagClass,
  WsNodeTagClass,
} from "./nodeCore"
import {
  type ServeLayerList,
  type ServesForCatalog,
} from "./nodeListenCommon"
import { http } from "./nodeHttp"
import { unix } from "./nodeUnix"
import { ws } from "./nodeWs"

/**
 * Prototype Node template (D7) — a Node kind, nested on {@link Node} as `Prototype`.
 * No address until cloned:
 *
 * ```ts
 * class MailWorker extends Prototype<MailWorker, Mail>("app/MailWorker") {}
 * // Named clone with a fixed address (class ctor):
 * class East extends MailWorker.make("East", { path: "/tmp/east.sock" }) {}
 * // Dynamic instances — curry serves once; factory takes suffix (auto when omitted):
 * const mailWorker = MailWorker.listen([Resource.serve(Mail, impl)])
 * mailWorker()
 * mailWorker("w1")
 * ```
 *
 * @category constructors
 * @public
 */
export const Prototype = <Self, ROut = never>(
  name: string,
  options?: { readonly kind?: ProtocolKind; readonly onConflict?: OnConflict },
) => {
  const protoOnConflict = options?.onConflict;
  const instance = (suffix?: string) => {
    const key =
      suffix !== undefined && suffix.length > 0 ? `${name}#${suffix}` : name;
    return Object.assign(
      Tag<Self, ROut>()(
        key,
        protoOnConflict !== undefined
          ? { onConflict: protoOnConflict }
          : undefined,
      ),
      {
        isDynamicInstance: true as const,
        dynamicPrototypeKey: name,
        ...(suffix !== undefined && suffix.length > 0
          ? { instanceSuffix: suffix }
          : {}),
      },
    );
  };
  function make(
    cloneName: string,
    target: {
      readonly path: string;
      readonly kind?: "IpcSocket";
      readonly onConflict?: OnConflict;
    },
  ): IpcNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target: {
      readonly url: `ws://${string}` | `wss://${string}`;
      readonly kind?: "WebSocket";
      readonly onConflict?: OnConflict;
    },
  ): WsNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target: {
      readonly url: string;
      readonly kind: "WebSocket";
      readonly onConflict?: OnConflict;
    },
  ): WsNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target: {
      readonly url: string;
      readonly kind: "Http";
      readonly onConflict?: OnConflict;
    },
  ): HttpNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target: {
      readonly url: string;
      readonly kind?: ProtocolKind;
      readonly onConflict?: OnConflict;
    },
  ): UrlNodeTagClass<Self, ROut>;
  function make(
    cloneName: string,
    target:
      | {
          readonly path: string;
          readonly kind?: "IpcSocket";
          readonly onConflict?: OnConflict;
        }
      | {
          readonly url: string;
          readonly kind?: ProtocolKind;
          readonly onConflict?: OnConflict;
        },
  ): IpcNodeTagClass<Self, ROut> | UrlNodeTagClass<Self, ROut> {
    const onConflict = target.onConflict ?? protoOnConflict;
    // Branch so each Tag call hits a dialable overload (not the loose union catch-all).
    if ("path" in target) {
      return Tag<Self, ROut>()(`${name}#${cloneName}`, {
        path: target.path,
        ...(target.kind !== undefined ? { kind: target.kind } : {}),
        ...(onConflict !== undefined ? { onConflict } : {}),
      });
    }
    return Tag<Self, ROut>()(`${name}#${cloneName}`, {
      url: target.url,
      ...(target.kind !== undefined ? { kind: target.kind } : {}),
      ...(onConflict !== undefined ? { onConflict } : {}),
    });
  }
  return Object.assign(Context.Service<Self, Record<string, never>>()(name), {
    isPrototype: true as const,
    kind: options?.kind,
    onConflict: protoOnConflict ?? ("inherit" as const),
    url: undefined as undefined,
    path: undefined as undefined,
    [catalogSym]: undefined as ROut | undefined,
    make,
    /**
     * Dynamic instance Node — wire key `prototypeKey#suffix`, for {@link listen} /
     * {@link peersLayer} `self`. Prefer {@link makePrototype}'s `.listen(serves)` to spawn.
     * Omit `suffix` to mint one at listen.
     */
    instance,
    /**
     * Curry a serve list into a dynamic-instance factory (sugar over
     * `unix` / `http` / `ws`(proto.instance(suffix), serves) by `kind`).
     * Returns a **Layer** only — after `Layer.build`, the minted Node is
     * {@link ListenNode} in context.
     */
    listen: <Serves extends ServeLayerList>(
      serves: Serves & ServesForCatalog<Exclude<ROut, undefined>, Serves>,
      listenOptions?: NamelessListenOptions,
    ): ((
      suffix?: string,
    ) => Layer.Layer<
      Layer.Success<Serves[number]> | ListenNode,
      never,
      Layer.Services<Serves[number]>
    >) =>
      (suffix?: string) => {
        // Explicit type args — avoid re-inferring `Serves` from the already-proven
        // intersection (nested `ServesForCatalog` would otherwise fail to unify).
        const node = instance(suffix);
        if (options?.kind === "Http") {
          return http<typeof node, Serves>(node, serves, listenOptions);
        }
        if (options?.kind === "WebSocket") {
          return ws<typeof node, Serves>(node, serves, listenOptions);
        }
        return unix<typeof node, Serves>(node, serves, listenOptions);
      },
  });
};
