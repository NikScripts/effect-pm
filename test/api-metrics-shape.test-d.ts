import { Schema, Stream } from "effect";
import * as ApiMetrics from "../src/ApiMetrics";
import { apiUsageSnapshot } from "../src/ApiUsageSchema";
import * as Resource from "../src/Resource";

type UsageSnapshot = Schema.Schema.Type<typeof apiUsageSnapshot>;
class Demo extends ApiMetrics.Tag<Demo>()("shape/api-metrics") {}
type Service = Resource.ShapeOf<Resource.SpecOf<typeof Demo>, typeof Demo>;

type UsageIsSubscribable = Service["usage"] extends Resource.Subscribable<UsageSnapshot>
  ? true
  : false;
true satisfies UsageIsSubscribable;

type UsageNowAbsent = "usageNow" extends keyof Service ? false : true;
true satisfies UsageNowAbsent;

type MetricsIsStream = Service["metrics"] extends Stream.Stream<unknown> ? true : false;
true satisfies MetricsIsStream;
