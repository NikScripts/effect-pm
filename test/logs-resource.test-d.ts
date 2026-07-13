import * as Resource from "../src/Resource";

class WithLogs extends Resource.Tag<WithLogs>()("@test/WithLogs", {}).pipe(
  Resource.withLogExport,
) {}

class WithoutLogs extends Resource.Tag<WithoutLogs>()("@test/WithoutLogs", {}) {}

void WithLogs.logs;

// @ts-expect-error logs absent without withLogExport pipe
void WithoutLogs.logs;
