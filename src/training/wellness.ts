import type { SourceWellnessContext, SourceWellnessDay } from '../session/source';

type RawWellness = Record<string, unknown>;

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isoTimestampOrNull(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  if (valid.length === 0) return null;
  return Number((valid.reduce((total, value) => total + value, 0) / valid.length).toFixed(1));
}

/**
 * Keep only the verified, coaching-relevant daily fields. The Intervals API
 * response itself is deliberately not retained, because it can include wider
 * personal health data than Pacer needs for the editor brief.
 */
export function normalizeIntervalsWellnessDay(raw: unknown): SourceWellnessDay | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as RawWellness;
  const date = isoDateOrNull(row.id);
  if (!date) return null;

  return {
    source: 'intervals',
    provenance: 'intervals_athlete_wellness',
    date,
    updatedAt: isoTimestampOrNull(row.updated),
    sleepDurationS: numberOrNull(row.sleepSecs),
    sleepScore: numberOrNull(row.sleepScore),
    sleepQuality: numberOrNull(row.sleepQuality),
    restingHeartRate: numberOrNull(row.restingHR),
    hrv: numberOrNull(row.hrv),
    weightKg: numberOrNull(row.weight),
    fitnessCtl: numberOrNull(row.ctl),
    fatigueAtl: numberOrNull(row.atl),
    acuteTrainingLoad: numberOrNull(row.atlLoad),
    chronicTrainingLoad: numberOrNull(row.ctlLoad),
    rampRate: numberOrNull(row.rampRate),
  };
}

export function buildIntervalsWellnessContext(
  sessionDate: string,
  rawRows: unknown[],
  fetchedAt = new Date().toISOString(),
): SourceWellnessContext {
  const days = rawRows
    .map(normalizeIntervalsWellnessDay)
    .filter((day): day is SourceWellnessDay => day !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
  const sessionDay = days.find((day) => day.date === sessionDate) ?? null;

  return {
    source: 'intervals',
    provenance: 'intervals_athlete_wellness',
    sessionDate,
    fetchedAt,
    sessionDay,
    recent: {
      daysConsidered: days.length,
      daysWithSleep: days.filter((day) => day.sleepDurationS !== null).length,
      daysWithRestingHeartRate: days.filter((day) => day.restingHeartRate !== null).length,
      averageSleepDurationS: average(days.map((day) => day.sleepDurationS)),
      averageSleepScore: average(days.map((day) => day.sleepScore)),
      averageRestingHeartRate: average(days.map((day) => day.restingHeartRate)),
    },
  };
}
