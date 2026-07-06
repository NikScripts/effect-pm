/** @internal */

export type StoreLogLevel = "All" | "Debug" | "Info" | "Warn" | "Error" | "None";

/** @internal */
export interface StoreLayerOptions {
  /**
   * SQLite database file path. When set, {@link Service.layer} provides {@link SqlEventJournal}
   * on that file (`:memory:` or a path). Omitted → {@link EventJournal.layerMemory}.
   */
  readonly filename?: string;
  /** Default durable log export level for registrations without an explicit pipe override. */
  readonly logLevel?: StoreLogLevel;
}

/** Per-registration retention cap — oldest rows are dropped after each append. @internal */
export type StoreRetentionOptions = {
  readonly maxRows?: number;
};
