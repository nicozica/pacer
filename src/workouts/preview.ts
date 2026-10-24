import { FutureWorkoutBlock, FutureWorkoutEffort, FutureWorkoutProposal, FutureWorkoutStepDuration } from './types';

function durationText(duration: FutureWorkoutStepDuration): string {
  if (duration.unit === 'distance') return `${(duration.meters / 1000).toFixed(duration.meters % 1000 === 0 ? 0 : 2)} km`;
  const minutes = Math.floor(duration.seconds / 60);
  const seconds = duration.seconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function paceText(value: number): string {
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.round(value % 60)).padStart(2, '0')} /km`;
}

function effortText(target: FutureWorkoutEffort): string {
  if (target.kind === 'unrestricted') return 'unrestricted effort';
  return target.minSecPerKm === target.maxSecPerKm
    ? paceText(target.minSecPerKm)
    : `${paceText(target.minSecPerKm)}–${paceText(target.maxSecPerKm)}`;
}

function blockLines(block: FutureWorkoutBlock, indent = ''): string[] {
  if (block.kind === 'repeat') {
    const heading = `${indent}Repeat ${block.repetitions}×${block.label ? ` — ${block.label}` : ''}`;
    return [heading, ...block.steps.flatMap((step) => blockLines(step, `${indent}  `))];
  }
  return [`${indent}${block.kind}: ${durationText(block.duration)} @ ${effortText(block.target)}${block.label ? ` — ${block.label}` : ''}`];
}

export function formatFutureWorkoutPreview(workout: FutureWorkoutProposal): string[] {
  return [
    `${workout.title} · ${workout.workoutType}`,
    `Scheduled: ${workout.schedule.localDate} (${workout.schedule.timezone})`,
    `Status: ${workout.lifecycle.approvalStatus} · sync ${workout.lifecycle.syncStatus}`,
    ...(workout.coachingNotes ? [`Notes: ${workout.coachingNotes}`] : []),
    ...workout.blocks.flatMap((block) => blockLines(block)),
  ];
}
