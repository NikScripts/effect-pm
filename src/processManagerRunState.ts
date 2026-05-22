import { Schema } from "effect";

/**
 * Persisted run metadata for an out-of-process group endpoint child.
 *
 * @public
 */
export interface ProcessManagerRunState {
  readonly args: ReadonlyArray<string>;
  readonly command: string;
  readonly controlBaseUrl: string;
  readonly cwd?: string;
  readonly endpointLabel: string;
  readonly groupId: string;
  readonly logPaths: {
    readonly stderr: string;
    readonly stdout: string;
  };
  readonly pid: number;
  readonly startedAt: string;
}

/**
 * @public
 */
export const ProcessManagerRunStateSchema = Schema.Struct({
  args: Schema.Array(Schema.String),
  command: Schema.String,
  controlBaseUrl: Schema.String,
  cwd: Schema.optional(Schema.String),
  endpointLabel: Schema.String,
  groupId: Schema.String,
  logPaths: Schema.Struct({
    stderr: Schema.String,
    stdout: Schema.String,
  }),
  pid: Schema.Number,
  startedAt: Schema.String,
});

/**
 * JSON wire codec for {@link ProcessManagerRunState}.
 *
 * @public
 */
export const ProcessManagerRunStateJson = Schema.fromJsonString(ProcessManagerRunStateSchema);

/**
 * @public
 */
export const encodeProcessManagerRunStateJson = (
  state: ProcessManagerRunState,
) => Schema.encodeEffect(ProcessManagerRunStateJson)(state);

/**
 * @public
 */
export const decodeProcessManagerRunStateJson = (
  text: string,
) => Schema.decodeUnknownEffect(ProcessManagerRunStateJson)(text);
