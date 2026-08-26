/**
 * Available models for the model picker in the new-session composer.
 * Confirmed hands-on: `client.provider.list()`'s raw response includes each
 * provider's API key inline (not in the SDK's declared type) — never touch
 * `.key`/log the raw response; only `.id`/`.name`/`.models` are read here.
 *
 * @internal
 */
import { client } from "./client";

export type ModelOption = {
  readonly providerID: string;
  readonly modelID: string;
  readonly name: string;
};

let cached: ReadonlyArray<ModelOption> | undefined;
let defaultModel: ModelOption | undefined;
let inFlight: Promise<ReadonlyArray<ModelOption>> | undefined;

const load = async (): Promise<ReadonlyArray<ModelOption>> => {
  const { data } = await client.provider.list();
  if (data === undefined) return [];

  const connected = new Set(data.connected);
  const options: Array<ModelOption> = [];
  for (const provider of data.all) {
    if (!connected.has(provider.id)) continue;
    for (const model of Object.values(provider.models)) {
      options.push({ providerID: provider.id, modelID: model.id, name: model.name });
    }
  }

  const defaultProviderID = data.connected.find((id) => data.default[id] !== undefined);
  if (defaultProviderID !== undefined) {
    const defaultModelID = data.default[defaultProviderID];
    defaultModel = options.find((o) => o.providerID === defaultProviderID && o.modelID === defaultModelID);
  }

  return options;
};

/** All connected models, fetched once and cached for the page's lifetime —
 * this list doesn't change without a server restart. */
export const listModels = (): Promise<ReadonlyArray<ModelOption>> => {
  if (cached !== undefined) return Promise.resolve(cached);
  if (inFlight !== undefined) return inFlight;
  inFlight = load()
    .then((options) => {
      cached = options;
      return options;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
};

/** The server's own configured default model — `undefined` until `listModels`
 * has resolved at least once. */
export const getDefaultModel = (): ModelOption | undefined => defaultModel;
