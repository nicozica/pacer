import * as assert from 'node:assert/strict';
import { estimateFutureWorkoutDistanceKm } from './distance';
import type { FutureWorkoutBlock } from './types';

const easyRun: FutureWorkoutBlock[] = [
  { kind: 'warmup', duration: { unit: 'time', seconds: 600 }, target: { kind: 'pace', minSecPerKm: 420, maxSecPerKm: 440 } },
  { kind: 'work', duration: { unit: 'time', seconds: 1800 }, target: { kind: 'pace', minSecPerKm: 395, maxSecPerKm: 430 } },
  { kind: 'cooldown', duration: { unit: 'time', seconds: 300 }, target: { kind: 'pace', minSecPerKm: 420, maxSecPerKm: 440 } },
];

assert.equal(estimateFutureWorkoutDistanceKm(easyRun), 6.5, '45-minute paced Easy Run should estimate to ~6.5 km');
assert.equal(estimateFutureWorkoutDistanceKm([
  { kind: 'warmup', duration: { unit: 'distance', meters: 1000 }, target: { kind: 'unrestricted' } },
  { kind: 'repeat', repetitions: 2, steps: [
    { kind: 'work', duration: { unit: 'time', seconds: 20 }, target: { kind: 'pace', minSecPerKm: 240, maxSecPerKm: 260 } },
    { kind: 'recovery', duration: { unit: 'time', seconds: 100 }, target: { kind: 'pace', minSecPerKm: 390, maxSecPerKm: 410 } },
  ] },
]), 1.7, 'repeat groups should multiply all measurable child steps');
assert.equal(estimateFutureWorkoutDistanceKm([
  { kind: 'work', duration: { unit: 'time', seconds: 600 }, target: { kind: 'unrestricted' } },
]), null, 'unrestricted timed work must not invent a distance');

console.log('Future workout distance estimation regression checks passed.');
