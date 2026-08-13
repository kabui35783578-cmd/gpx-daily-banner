import type { DailyDataRecord } from "./types";

export function shouldBlockAutomaticGpxForDailyData(
  record: Pick<DailyDataRecord, "status"> | undefined,
  hasCompleteBanner: boolean
): boolean {
  return record?.status === "processed" && hasCompleteBanner;
}
