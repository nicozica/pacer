import FitParser from 'fit-file-parser';
import type { SourceGarminDeviceLap } from '../session/source';

interface ParsedFitLap {
  start_time?: unknown;
  timestamp?: unknown;
  total_elapsed_time?: unknown;
  total_timer_time?: unknown;
  total_distance?: unknown;
  avg_heart_rate?: unknown;
  lap_trigger?: unknown;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function normalizeGarminFitLaps(parsedLaps: ParsedFitLap[]): SourceGarminDeviceLap[] {
  const firstStartMs = parsedLaps
    .map((lap) => timestampMs(lap.start_time))
    .find((value): value is number => value !== null) ?? null;

  return parsedLaps.flatMap((lap, index): SourceGarminDeviceLap[] => {
    const movingTimeS = finiteNumber(lap.total_timer_time);
    const elapsedTimeS = finiteNumber(lap.total_elapsed_time);
    const distanceM = finiteNumber(lap.total_distance);
    const paceDurationS = movingTimeS ?? elapsedTimeS;
    const startMs = timestampMs(lap.start_time);
    const endMs = timestampMs(lap.timestamp);

    if (movingTimeS === null && elapsedTimeS === null && distanceM === null) return [];

    return [{
      source: 'garmin_fit',
      provenance: 'intervals_activity_original_fit',
      lapIndex: index + 1,
      lapTrigger: typeof lap.lap_trigger === 'string' && lap.lap_trigger.trim() ? lap.lap_trigger : null,
      startOffsetS: firstStartMs === null || startMs === null ? null : (startMs - firstStartMs) / 1000,
      endOffsetS: firstStartMs === null || endMs === null ? null : (endMs - firstStartMs) / 1000,
      movingTimeS,
      elapsedTimeS,
      distanceM,
      paceSecPerKm: paceDurationS !== null && distanceM !== null && paceDurationS > 0 && distanceM > 0
        ? Math.round((paceDurationS / distanceM) * 1000)
        : null,
      averageHeartrate: finiteNumber(lap.avg_heart_rate),
    }];
  });
}

export async function parseGarminFitLaps(content: Buffer): Promise<SourceGarminDeviceLap[]> {
  const parser = new FitParser({
    mode: 'list',
    speedUnit: 'm/s',
    lengthUnit: 'm',
    force: false,
    strict: true,
  });
  const input = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  const parsed = await parser.parseAsync(input);
  const laps = Array.isArray(parsed.laps) ? parsed.laps as ParsedFitLap[] : [];
  return normalizeGarminFitLaps(laps);
}
