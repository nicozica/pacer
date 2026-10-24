(function exposePacerBriefSegments(root) {
  function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function formatDuration(seconds) {
    const value = numberOrNull(seconds);
    if (value === null || value < 0) return '—';
    const rounded = Math.round(value);
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
  }

  function formatPace(secondsPerKm) {
    const value = numberOrNull(secondsPerKm);
    if (value === null || value <= 0) return '—';
    const rounded = Math.round(value);
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return `${minutes}:${String(remainder).padStart(2, '0')} /km`;
  }

  function formatDistance(distanceM) {
    const value = numberOrNull(distanceM);
    return value === null ? '—' : `${(value / 1000).toFixed(2)} km`;
  }

  function formatOffsets(segment) {
    const start = numberOrNull(segment?.startTimeS);
    const end = numberOrNull(segment?.endTimeS);
    if (start === null && end === null) return '—';
    return `${start === null ? '—' : formatDuration(start)} → ${end === null ? '—' : formatDuration(end)}`;
  }

  function formatWellnessDuration(seconds) {
    const value = numberOrNull(seconds);
    if (value === null || value < 0) return '—';
    const roundedMinutes = Math.round(value / 60);
    const hours = Math.floor(roundedMinutes / 60);
    const minutes = roundedMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  function formatRange(min, max) {
    const low = numberOrNull(min);
    const high = numberOrNull(max);
    if (low === null && high === null) return '—';
    return `${low === null ? '—' : Math.round(low)}–${high === null ? '—' : Math.round(high)}`;
  }

  function formatGarminClock(localDateTime) {
    if (typeof localDateTime !== 'string') return null;
    const match = localDateTime.match(/(?:T|\s)(\d{2}:\d{2})/);
    return match ? match[1] : null;
  }

  function formatWellness(context) {
    if (!context || context.provenance !== 'intervals_athlete_wellness') {
      return ['Wellness: unavailable from Intervals.icu for this session date.'];
    }

    const day = context.sessionDay;
    const garmin = context.garmin?.provenance === 'garmin_personal_api_wellness'
      && context.garmin?.availability !== 'unavailable'
      && context.garmin?.sessionDay
      ? context.garmin
      : null;
    const garminDay = garmin?.sessionDay || null;
    const garminStatus = context.garmin?.provenance === 'garmin_personal_api_wellness' ? context.garmin : null;
    const recent = context.recent || {};
    const lines = [
      garmin
        ? `Source: Garmin Personal API recovery (${garmin.availability}) | Intervals.icu training load | session date ${context.sessionDate || '—'}`
        : `Source: Intervals.icu daily wellness | session date ${context.sessionDate || '—'} | record updated ${day?.updatedAt || '—'}`,
    ];
    if (garminStatus?.availability === 'stale') {
      lines.push(`Garmin wellness warning: using stale data from ${garminStatus.lastSuccessfulFetch || 'an unknown time'} (${garminStatus.failureReason || 'refresh failed'}); Intervals fallback remains active.`);
    } else if (garminStatus?.availability === 'unavailable' && garminStatus.failureReason) {
      lines.push(`Garmin wellness warning: unavailable (${garminStatus.failureReason}); using Intervals fallback.`);
    }
    if (garminStatus?.keyExpiryStatus === 'expired') lines.push('Garmin wellness warning: Personal API key is expired; renew it to restore Garmin recovery data.');
    else if (garminStatus?.keyExpiryStatus === 'expires_within_7_days') lines.push('Garmin wellness warning: Personal API key expires within 7 days.');
    else if (garminStatus?.keyExpiryStatus === 'expires_within_30_days') lines.push('Garmin wellness warning: Personal API key expires within 30 days.');

    if (!day) {
      lines.push('Session-day wellness: unavailable.');
    } else {
      const sessionMetrics = [];
      const sleepDuration = numberOrNull(garminDay?.sleepDurationS) ?? numberOrNull(day.sleepDurationS);
      const sleepScore = numberOrNull(garminDay?.sleepScore) ?? numberOrNull(day.sleepScore);
      const restingHeartRate = numberOrNull(garminDay?.restingHeartRate) ?? numberOrNull(day.restingHeartRate);
      const hrv = numberOrNull(day.hrv);
      const weight = numberOrNull(garminDay?.weightKg) ?? numberOrNull(day.weightKg);
      const fitness = numberOrNull(day.fitnessCtl);
      const fatigue = numberOrNull(day.fatigueAtl);
      const acuteLoad = numberOrNull(day.acuteTrainingLoad);
      const chronicLoad = numberOrNull(day.chronicTrainingLoad);

      if (sleepDuration !== null) sessionMetrics.push(`sleep ${formatWellnessDuration(sleepDuration)}`);
      if (sleepScore !== null) sessionMetrics.push(`sleep score ${Math.round(sleepScore)}/100`);
      if (restingHeartRate !== null) sessionMetrics.push(`resting HR ${Math.round(restingHeartRate)} bpm`);
      if (hrv !== null) sessionMetrics.push(`HRV ${hrv} (Intervals field)`);
      if (garminDay) {
        const morningBattery = numberOrNull(garminDay.bodyBatteryMorning);
        const latestBattery = numberOrNull(garminDay.bodyBatteryLatest);
        const minBattery = numberOrNull(garminDay.bodyBatteryMin);
        const maxBattery = numberOrNull(garminDay.bodyBatteryMax);
        const charged = numberOrNull(garminDay.bodyBatteryCharged);
        const drained = numberOrNull(garminDay.bodyBatteryDrained);
        if (morningBattery !== null) sessionMetrics.push(`morning Body Battery ${Math.round(morningBattery)}`);
        if (minBattery !== null || maxBattery !== null) sessionMetrics.push(`Body Battery range ${formatRange(minBattery, maxBattery)}${latestBattery === null ? '' : `, latest ${Math.round(latestBattery)}`}`);
        if (charged !== null || drained !== null) sessionMetrics.push(`Body Battery charge/drain ${charged === null ? '—' : Math.round(charged)}/${drained === null ? '—' : Math.round(drained)}`);
        const stages = [
          ['deep', numberOrNull(garminDay.deepSleepS)], ['light', numberOrNull(garminDay.lightSleepS)], ['REM', numberOrNull(garminDay.remSleepS)],
        ].filter(([, value]) => value !== null).map(([label, value]) => `${label} ${formatWellnessDuration(value)}`);
        if (stages.length) sessionMetrics.push(`sleep stages ${stages.join(', ')}`);
        const sleepStart = formatGarminClock(garminDay.sleepStartLocal);
        const sleepEnd = formatGarminClock(garminDay.sleepEndLocal);
        if (sleepStart && sleepEnd) sessionMetrics.push(`sleep window ${sleepStart}–${sleepEnd} (athlete local time)`);
        const stress = numberOrNull(garminDay.stressLevel);
        if (stress !== null) sessionMetrics.push(`daily stress ${Math.round(stress)}`);
      }
      if (weight !== null) sessionMetrics.push(`weight ${weight.toFixed(1)} kg (${garminDay ? 'Garmin' : 'Intervals'})`);
      if (fitness !== null) sessionMetrics.push(`fitness CTL ${fitness.toFixed(1)}`);
      if (fatigue !== null) sessionMetrics.push(`fatigue ATL ${fatigue.toFixed(1)}`);
      if (acuteLoad !== null) sessionMetrics.push(`acute load ${Math.round(acuteLoad)}`);
      if (chronicLoad !== null) sessionMetrics.push(`chronic load ${Math.round(chronicLoad)}`);
      lines.push(`Session-day: ${sessionMetrics.length > 0 ? sessionMetrics.join(' | ') : 'no mapped metrics available.'}`);
    }

    const trend = [];
    const averageSleepDuration = numberOrNull(recent.averageSleepDurationS);
    const averageSleepScore = numberOrNull(recent.averageSleepScore);
    const averageRestingHeartRate = numberOrNull(recent.averageRestingHeartRate);
    if (averageSleepDuration !== null) trend.push(`average sleep ${formatWellnessDuration(averageSleepDuration)}`);
    if (averageSleepScore !== null) trend.push(`average sleep score ${Math.round(averageSleepScore)}/100`);
    if (averageRestingHeartRate !== null) trend.push(`average resting HR ${Math.round(averageRestingHeartRate)} bpm`);
    const daysConsidered = Number.isInteger(recent.daysConsidered) ? recent.daysConsidered : 0;
    lines.push(`Recent recovery (${daysConsidered} days): ${trend.length > 0 ? trend.join(' | ') : 'unavailable.'}`);
    lines.push('Source note: CTL/ATL and load are Intervals training-model metrics, not Garmin Body Battery. Weight is a single Intervals reading and may mirror a Garmin-synced BLE scale measurement.');
    return lines;
  }

  function formatGarminDeviceLaps(laps) {
    if (!Array.isArray(laps) || laps.length === 0) {
      return ['Garmin device laps: unavailable from the original FIT.'];
    }

    return laps.map((lap, arrayIndex) => {
      const index = Number.isInteger(lap?.lapIndex) ? lap.lapIndex : arrayIndex + 1;
      const movingDuration = numberOrNull(lap?.movingTimeS);
      const elapsedDuration = numberOrNull(lap?.elapsedTimeS);
      const durationLabel = movingDuration === null ? 'elapsed duration' : 'moving duration';
      const duration = movingDuration ?? elapsedDuration;
      const hr = numberOrNull(lap?.averageHeartrate);
      const trigger = typeof lap?.lapTrigger === 'string' && lap.lapTrigger.trim()
        ? ` | trigger ${lap.lapTrigger.trim()}`
        : '';

      return [
        `Garmin lap ${index}${trigger}`,
        `${durationLabel} ${formatDuration(duration)}`,
        `distance ${formatDistance(lap?.distanceM)}`,
        `pace ${formatPace(lap?.paceSecPerKm)}`,
        `average HR ${hr === null ? '—' : `${Math.round(hr)} bpm`}`,
        `offsets ${formatOffsets({ startTimeS: lap?.startOffsetS, endTimeS: lap?.endOffsetS })}`,
      ].join(' | ');
    });
  }

  function formatDetectedIntervals(segments) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return ['Detected intervals: unavailable from Intervals.icu.'];
    }

    return segments.map((segment, arrayIndex) => {
      const index = Number.isInteger(segment?.intervalIndex) ? segment.intervalIndex : arrayIndex + 1;
      const type = typeof segment?.intervalType === 'string' && segment.intervalType.trim()
        ? segment.intervalType.trim()
        : '—';
      const movingDuration = numberOrNull(segment?.movingTimeS);
      const elapsedDuration = numberOrNull(segment?.elapsedTimeS);
      const durationLabel = movingDuration === null ? 'elapsed duration' : 'moving duration';
      const duration = movingDuration ?? elapsedDuration;
      const hr = numberOrNull(segment?.averageHeartrate);

      return [
        `Segment ${index} | source type ${type}`,
        `${durationLabel} ${formatDuration(duration)}`,
        `distance ${formatDistance(segment?.distanceM)}`,
        `average pace ${formatPace(segment?.averagePaceSecPerKm)}`,
        `average HR ${hr === null ? '—' : `${Math.round(hr)} bpm`}`,
        `offsets ${formatOffsets(segment)}`,
      ].join(' | ');
    });
  }

  function summarizeDetectedIntervals(segments) {
    const count = Array.isArray(segments) ? segments.length : 0;
    return count > 0
      ? [`Detected intervals: ${count} Intervals.icu analytical estimates are available in the editor API; omitted here because original FIT Garmin device laps are present above.`]
      : ['Detected intervals: unavailable from Intervals.icu.'];
  }

  const api = {
    detectedIntervalsDisclaimer: 'Source note: detected segments are Intervals.icu analysis, not Garmin/device laps or confirmed workout steps.',
    garminDeviceLapsDisclaimer: 'Source note: original FIT device laps are completed boundaries; they do not prove planned workout-step semantics.',
    formatGarminDeviceLaps,
    formatDetectedIntervals,
    summarizeDetectedIntervals,
    formatWellness,
  };
  root.PacerBriefSegments = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof window !== 'undefined' ? window : globalThis));
