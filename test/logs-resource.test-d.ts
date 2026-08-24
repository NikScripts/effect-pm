import * as Hyperlink from "../src/Hyperlink";

class WithLogs extends Hyperlink.Service<WithLogs>()("@test/WithLogs", {}).pipe(
  Hyperlink.withLogExport,
) {}

class WithoutLogs extends Hyperlink.Service<WithoutLogs>()("@test/WithoutLogs", {}) {}

void WithLogs.logs;

// @ts-expect-error logs absent without withLogExport pipe
void WithoutLogs.logs;
