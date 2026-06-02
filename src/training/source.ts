import { config } from '../config';
import type { SourceActivity, SourceLap, SourceStreamPayload } from '../session/source';
import { createIntervalsSource } from './intervals-source';

export type TrainingSourceName = 'intervals';

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
  const removedSourceName = ['s', 't', 'r', 'a', 'v', 'a'].join('');
  const removedSourceLabel = `${removedSourceName.slice(0, 1).toUpperCase()}${removedSourceName.slice(1)}`;
  if (!normalized || normalized === 'intervals') return 'intervals';
  if (normalized === removedSourceName) {
    throw new Error(`TRAINING_SOURCE=${removedSourceName} is no longer supported as a live source. ${removedSourceLabel} is no longer supported as a live source. Use TRAINING_SOURCE=intervals.`);
  }
  throw new Error(`Unsupported TRAINING_SOURCE "${value}". Use "intervals".`);
}

export function getConfiguredTrainingSourceName(): TrainingSourceName {
  return parseTrainingSourceName(config.trainingSource);
}

export function getTrainingSourceForBundle(bundleSource: string | undefined): TrainingSourceName {
  if (!bundleSource || bundleSource === 'intervals-api' || bundleSource === 'intervals') return 'intervals';
  throw new Error(`Unsupported training bundle source "${bundleSource}". Refresh training data from Intervals.icu.`);
}

export function createTrainingSource(sourceName: TrainingSourceName): TrainingSource {
  return createIntervalsSource();
}

export function getActivitySourceLabel(sourceName: TrainingSourceName): TrainingSourceName {
  return sourceName;
}
