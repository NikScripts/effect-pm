/** @internal */

export type StoreLogLevel = "All" | "Debug" | "Info" | "Warn" | "Error" | "None";

/** @internal */
export interface StoreLayerOptions {
  readonly filename?: string;
  readonly logLevel?: StoreLogLevel;
}
