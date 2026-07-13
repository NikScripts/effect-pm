/**
 * Type-level proof: {@link Resource.effectFn} requires a non-void payload.
 */
import { Schema } from "effect";
import * as Resource from "../src/Resource";

// effectFn() is the two-stage entry (returns a builder for the `<Client>` override form); valid.
void Resource.effectFn();

// @ts-expect-error the two-stage second call still requires a non-void payload
Resource.effectFn()(Schema.Void);

// @ts-expect-error Schema.Void is not a payload — use effect for inputless commands
Resource.effectFn(Schema.Void);

void Resource.effectFn({ id: Schema.String });
void Resource.effectFn({ payload: { id: Schema.String } });
void Resource.effectFn(Schema.String, Schema.Number);
void Resource.effectFn({ payload: { id: Schema.String } });
