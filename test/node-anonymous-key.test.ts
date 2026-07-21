import { Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import { anonymousNodeKey } from "../src/internal/nodeListenCommon";

class Emails extends Resource.Tag<Emails>()("@app/Emails", {
  send: Resource.effect(Schema.String),
}) {}

it("serve stamps its tag key on the layer (for anonymous node naming)", () => {
  const layer = Resource.serve(Emails, { send: Effect.succeed("ok") });
  expect(Resource.servedKeyOf(layer)).toBe("@app/Emails");
});

it("anonymous node key = full prefix + name from first served key (last segment) + random tail", () => {
  const stamped = Object.assign(Layer.effectDiscard(Effect.void), {
    [Resource.servedKeySym]: "@app/Emails",
  });
  const key = Effect.runSync(anonymousNodeKey([stamped]));
  // @app/Emails -> Emails
  expect(key).toMatch(
    /^@nikscripts\/effect-pm\/anonymous-node\/Emails#[a-z0-9]+$/,
  );
});
