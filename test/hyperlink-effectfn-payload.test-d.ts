/**
 * Type-level proof: {@link Hyperlink.effectFn} requires a non-void payload.
 */
import { Schema } from "effect";
import * as Hyperlink from "../src/Hyperlink";

// effectFn() is the two-stage entry (returns a builder for the `<Client>` override form); valid.
void Hyperlink.effectFn();

// @ts-expect-error the two-stage second call still requires a non-void payload
Hyperlink.effectFn()(Schema.Void);

// @ts-expect-error Schema.Void is not a payload — use effect for inputless commands
Hyperlink.effectFn(Schema.Void);

void Hyperlink.effectFn({ id: Schema.String });
void Hyperlink.effectFn({ payload: { id: Schema.String } });
void Hyperlink.effectFn(Schema.String, Schema.Number);
void Hyperlink.effectFn({ payload: { id: Schema.String } });
