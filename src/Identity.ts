/**
 * Identity — exclusive HyperService key claims (first wins; dead winners replaceable).
 *
 * Sibling of {@link Lookup} (not nested under it). Wire id stays
 * `hyperlink-ts/Lookup/Identity` for protocol stability.
 *
 * ```ts
 * import * as Identity from "hyperlink-ts/Identity"
 *
 * const id = yield* Identity.Service
 * yield* id.claim(new Identity.ClaimRequest({ … }))
 * ```
 *
 * Never `import { Identity } from "hyperlink-ts/Lookup"`.
 *
 * @module Identity
 */
import { Schema } from "effect";
import * as Hyperlink from "./Hyperlink";

/** Kind stamped on Lookup-family HyperServices. @public */
export const kind = "hyperlink-ts/Lookup";

/**
 * Where a winning claimant / advertised node lives — node key + transport address.
 *
 * @category wire schemas
 * @public
 */
export class Endpoint extends Schema.Class<Endpoint>("LookupEndpoint")({
  nodeKey: Schema.String,
  kind: Schema.Literals(["Http", "WebSocket", "IpcSocket"]),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
}) {}

/**
 * Claim payload — hyperlink identity key plus the claimant's endpoint.
 *
 * @category wire schemas
 * @public
 */
export class ClaimRequest extends Schema.Class<ClaimRequest>("LookupClaimRequest")({
  key: Schema.String,
  nodeKey: Schema.String,
  kind: Schema.Literals(["Http", "WebSocket", "IpcSocket"]),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
}) {}

/**
 * Resolve payload — look up a winning claim by HyperService key (nodeless clients).
 *
 * @category wire schemas
 * @public
 */
export class ResolveRequest extends Schema.Class<ResolveRequest>("LookupResolveRequest")({
  key: Schema.String,
}) {}

/**
 * Another process already owns this HyperService key — `original` is where to dial.
 *
 * @category errors
 * @public
 */
export class DuplicateIdentity extends Schema.TaggedErrorClass<DuplicateIdentity>()(
  "DuplicateIdentity",
  {
    key: Schema.String,
    original: Endpoint,
  },
) {}

const identitySpec = {
  claim: Hyperlink.effectFn({
    payload: ClaimRequest,
    success: Endpoint,
    error: DuplicateIdentity,
  }).annotate({
    description:
      "First claim for `key` wins and returns the endpoint. Later claims: same dial " +
      "refreshes; dead/unreachable incumbent (node-handle ping) is replaced; a live " +
      "different dial fails with DuplicateIdentity.",
  }),
  resolve: Hyperlink.effectFn({
    payload: ResolveRequest,
    success: Schema.Option(Endpoint),
  }).annotate({
    description:
      "Read the winning endpoint for `key` without claiming (nodeless / lookupClient).",
  }),
};

/**
 * Identity Tag — Context key for the Identity HyperService.
 *
 * @category services
 * @public
 */
export class Service extends Hyperlink.Service<Service>()(
  "hyperlink-ts/Lookup/Identity",
  identitySpec,
  { kind },
) {}
