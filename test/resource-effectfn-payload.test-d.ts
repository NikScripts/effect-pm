/**
 * Type-level proof: {@link Resource.effectFn} requires a non-void payload.
 */
import { Schema } from "effect";
import * as Resource from "../src/Resource";

// @ts-expect-error effectFn requires payload — inputless members use effect
Resource.effectFn();

// @ts-expect-error Schema.Void is not a payload — use effect for inputless commands
Resource.effectFn(Schema.Void);

void Resource.effectFn({ id: Schema.String });
void Resource.effectFn({ payload: { id: Schema.String } });
void Resource.effectFn(Schema.String, Schema.Number);
void Resource.effectFn({ payload: { id: Schema.String } });
