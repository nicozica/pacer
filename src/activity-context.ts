import {
  ActivityBundle,
  SourceActivity,
  getActivityType,
  isRunLike,
  sortActivitiesDesc,
} from './session/source';

const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide']);

export interface DerivedActivityContext {
  latestTraining: SourceActivity | null;
  latestRide: SourceActivity | null;
}

export function isRideActivity(activity: SourceActivity): boolean {
  return RIDE_TYPES.has(getActivityType(activity));
}

export function isTrainingActivity(activity: SourceActivity): boolean {
  const type = getActivityType(activity);

  if (isRunLike(activity) || isRideActivity(activity)) {
    return false;
  }

  return !['Walk', 'Hike'].includes(type);
}

export function deriveActivityContext(bundle: ActivityBundle | null): DerivedActivityContext {
  const sortedActivities = bundle ? sortActivitiesDesc(bundle.activities) : [];

  return {
    latestTraining: sortedActivities.find(isTrainingActivity) ?? null,
    latestRide: sortedActivities.find(isRideActivity) ?? null,
  };
}
