const DAY_MS = 24 * 60 * 60 * 1000;

// Wellness records can arrive after an activity, but historical records are
// effectively immutable for the coaching workflow. Keep recent records cheap
// to retry without making editor selection repeatedly call the API.
export const RECENT_WELLNESS_DAYS = 7;
export const RECENT_WELLNESS_REFRESH_MS = 6 * 60 * 60 * 1000;

function dateTimestamp(date: string): number | null {
  const timestamp = Date.parse(`${date}T12:00:00Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function isRecentSessionDate(sessionDate: string, now = new Date()): boolean {
  const sessionTimestamp = dateTimestamp(sessionDate);
  if (sessionTimestamp === null) return false;
  const todayTimestamp = dateTimestamp(now.toISOString().slice(0, 10));
  if (todayTimestamp === null) return false;
  const ageDays = Math.floor((todayTimestamp - sessionTimestamp) / DAY_MS);
  return ageDays >= -1 && ageDays <= RECENT_WELLNESS_DAYS;
}

export function isWellnessCacheFresh(
  sessionDate: string,
  fetchedAt: string,
  now = new Date(),
): boolean {
  if (!isRecentSessionDate(sessionDate, now)) return true;
  const fetchedTimestamp = Date.parse(fetchedAt);
  if (Number.isNaN(fetchedTimestamp)) return false;
  return now.getTime() - fetchedTimestamp < RECENT_WELLNESS_REFRESH_MS;
}

export function shouldCacheGarminDeviceLaps<T>(laps: T[] | null | undefined): laps is T[] {
  return Array.isArray(laps) && laps.length > 0;
}
