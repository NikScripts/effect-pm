/**
 * Connected models from `client.provider.list()`. Never log or touch the
 * raw provider `.key` field — the response includes API keys inline (not
 * in the SDK’s declared type); only `.id` / `.name` / `.models` are read.
 *
 * @internal
 */
import type { OpencodeClient } from "./client";

export type ModelOption = {
  readonly providerID: string;
  /** Provider display name from the server (`provider.name`), not reformatted. */
  readonly providerName: string;
  readonly modelID: string;
  readonly name: string;
};

export const modelKey = (model: Pick<ModelOption, "providerID" | "modelID">): string =>
  `${model.providerID}/${model.modelID}`;

type Cache = {
  readonly options: ReadonlyArray<ModelOption>;
  readonly defaultModel: ModelOption | undefined;
};

const caches = new WeakMap<OpencodeClient, Cache>();
const inFlight = new WeakMap<OpencodeClient, Promise<Cache>>();

const load = async (client: OpencodeClient): Promise<Cache> => {
  const { data } = await client.provider.list();
  if (data === undefined) return { options: [], defaultModel: undefined };

  const connected = new Set(data.connected);
  const options: Array<ModelOption> = [];
  for (const provider of data.all) {
    if (!connected.has(provider.id)) continue;
    for (const model of Object.values(provider.models)) {
      options.push({
        providerID: provider.id,
        providerName: provider.name,
        modelID: model.id,
        name: model.name,
      });
    }
  }

  const defaultProviderID = data.connected.find((id) => data.default[id] !== undefined);
  const defaultModelID = defaultProviderID !== undefined ? data.default[defaultProviderID] : undefined;
  const defaultModel =
    defaultProviderID !== undefined && defaultModelID !== undefined
      ? options.find((o) => o.providerID === defaultProviderID && o.modelID === defaultModelID)
      : undefined;

  return { options, defaultModel };
};

/** Connected models for this client, cached for the process lifetime. */
export const listModels = async (client: OpencodeClient): Promise<ReadonlyArray<ModelOption>> => {
  const hit = caches.get(client);
  if (hit !== undefined) return hit.options;
  const pending = inFlight.get(client);
  if (pending !== undefined) return (await pending).options;
  const promise = load(client).then((cache) => {
    caches.set(client, cache);
    return cache;
  });
  inFlight.set(client, promise);
  try {
    return (await promise).options;
  } finally {
    inFlight.delete(client);
  }
};

/** Server default model once `listModels` has resolved for this client. */
export const getDefaultModel = (client: OpencodeClient): ModelOption | undefined =>
  caches.get(client)?.defaultModel;

export const findModel = (
  options: ReadonlyArray<ModelOption>,
  providerID: string,
  modelID: string,
): ModelOption | undefined => options.find((o) => o.providerID === providerID && o.modelID === modelID);
