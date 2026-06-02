import { config } from '../config';
import type { SourceActivity, SourceLap, SourceStreamPayload } from '../session/source';
import { createIntervalsSource } from './intervals-source';
import { createStravaSource } from './strava-source';

export type TrainingSourceName = 'strava' | 'intervals';

export interface TrainingFetchOptions {
  oldest?: string;
  newest?: string;
}

export interface TrainingSource {
  name: TrainingSourceName;
  bundleSource: string;
  displayName: string;
  fetchActivities(options?: TrainingFetchOptions): Promise<SourceActivity[]>;
  fetchWellness?(options?: TrainingFetchOptions): Promise<unknown[]>;
  fetchActivityDetail?(sourceActivityId: number): Promise<SourceActivity | null>;
  fetchActivityLaps?(sourceActivityId: number): Promise<SourceLap[]>;
  fetchActivityStreams?(sourceActivityId: number): Promise<SourceStreamPayload | null>;
}

export function parseTrainingSourceName(value: string | undefined): TrainingSourceName {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return 'strava';
  if (normalized === 'strava' || normalized === 'intervals') return normalized;
  throw new Error(`Unsupported TRAINING_SOURCE "${value}". Use "strava" or "intervals".`);
}

export function getConfiguredTrainingSourceName(): TrainingSourceName {
  return parseTrainingSourceName(config.trainingSource);
}

export function getTrainingSourceForBundle(bundleSource: string | undefined): TrainingSourceName {
  if (bundleSource === 'intervals-api' || bundleSource === 'intervals') return 'intervals';
  return 'strava';
}

export function createTrainingSource(sourceName: TrainingSourceName): TrainingSource {
  return sourceName === 'intervals' ? createIntervalsSource() : createStravaSource();
}

export function getActivitySourceLabel(sourceName: TrainingSourceName): TrainingSourceName {
  return sourceName;
}
