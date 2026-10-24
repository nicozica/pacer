import type { FutureWorkoutBlock, FutureWorkoutStep } from './types';

function estimateStepDistanceKm(step: FutureWorkoutStep): number | null {
  if (step.duration.unit === 'distance') {
    return Number.isFinite(step.duration.meters) && step.duration.meters > 0
      ? step.duration.meters / 1000
      : null;
  }

  if (step.target.kind !== 'pace') return null;
  const { seconds } = step.duration;
  const { minSecPerKm, maxSecPerKm } = step.target;
  if (!Number.isFinite(seconds) || seconds <= 0
    || !Number.isFinite(minSecPerKm) || minSecPerKm <= 0
    || !Number.isFinite(maxSecPerKm) || maxSecPerKm < minSecPerKm) {
    return null;
  }

  // Pace is seconds per kilometre. Its target-range midpoint is one
  // transparent estimate without treating either bound as prescribed.
  return seconds / ((minSecPerKm + maxSecPerKm) / 2);
}

/** Returns a rounded estimate only when every planned block is measurable. */
export function estimateFutureWorkoutDistanceKm(blocks: FutureWorkoutBlock[]): number | null {
  if (blocks.length === 0) return null;

  let totalKm = 0;
  for (const block of blocks) {
    if (block.kind !== 'repeat') {
      const distanceKm = estimateStepDistanceKm(block);
      if (distanceKm === null) return null;
      totalKm += distanceKm;
      continue;
    }

    if (!Number.isInteger(block.repetitions) || block.repetitions <= 0 || block.steps.length === 0) return null;
    let repetitionKm = 0;
    for (const step of block.steps) {
      const distanceKm = estimateStepDistanceKm(step);
      if (distanceKm === null) return null;
      repetitionKm += distanceKm;
    }
    totalKm += repetitionKm * block.repetitions;
  }

  return Number.isFinite(totalKm) && totalKm > 0 ? Number(totalKm.toFixed(1)) : null;
}
