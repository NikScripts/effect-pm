import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Gate from "../src/Gate";
import { apiUsageSnapshot } from "../src/ApiUsageSchema";
import * as Hyperlink from "../src/Hyperlink";

type UsageSnapshot = Schema.Schema.Type<typeof apiUsageSnapshot>;

const ping = HttpApiEndpoint.get("ping", "/ping", {
  success: Schema.Struct({ pong: Schema.Boolean }),
});
const api = HttpApi.make("shape-api").add(HttpApiGroup.make("g").add(ping));

class Demo extends Gate.HttpApiClient<Demo>()("shape/http-api", api) {}
type Service = Hyperlink.Shape<typeof Demo>;

type UsageIsSubscribable = Service["metrics"]["usage"] extends Hyperlink.Subscribable<UsageSnapshot>
  ? true
  : false;
true satisfies UsageIsSubscribable;

type UsageNowAbsent = "usageNow" extends keyof Service["metrics"] ? false : true;
true satisfies UsageNowAbsent;

type WindowsPresent = "windows" extends keyof Service["metrics"] ? true : false;
true satisfies WindowsPresent;
