import { Schema, Stream } from "effect";
import * as ApiMetrics from "../src/ApiMetrics";
import { apiUsageSnapshot } from "../src/ApiUsageSchema";
import * as Hyperlink from "../src/Hyperlink";

type UsageSnapshot = Schema.Schema.Type<typeof apiUsageSnapshot>;
class Demo extends ApiMetrics.Tag<Demo>()("shape/api-metrics") {}
type Service = Hyperlink.ShapeOf<Hyperlink.SpecOf<typeof Demo>, typeof Demo>;

type UsageIsSubscribable = Service["usage"] extends Hyperlink.Subscribable<UsageSnapshot>
  ? true
  : false;
true satisfies UsageIsSubscribable;

type UsageNowAbsent = "usageNow" extends keyof Service ? false : true;
true satisfies UsageNowAbsent;

type MetricsIsStream = Service["metrics"] extends Stream.Stream<unknown> ? true : false;
true satisfies MetricsIsStream;
