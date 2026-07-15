/** @internal */

export type StoreLogLevel = "All" | "Debug" | "Info" | "Warn" | "Error" | "None";

/** Options for {@link Service.layer} / {@link store.layer} — SQLite only. @internal */
export interface StoreLayerOptions {
  /**
   * SQLite database file path (`:memory:` or a durable path). Required —
   * use {@link Service.layerMemory} for an in-memory journal.
   */
  readonly filename: string;
  /** Default durable log export level for registrations without an explicit pipe override. */
  readonly logLevel?: StoreLogLevel;
}

/** Per-registration retention cap — oldest rows are dropped after each append. @internal */
export type StoreRetentionOptions = {
  readonly maxRows?: number;
};
