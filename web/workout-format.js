/* Garmin-style display of a future workout. Internal block kinds never reach the UI. */
(function attachWorkoutFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PacerWorkoutFormat = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkoutFormat() {
  const KIND_LABELS = { warmup: 'Warm up', work: 'Run', recovery: 'Recover', cooldown: 'Cool down' };
  // The contract has no walk/rest kinds; a step may say so in its own label.
  const LABEL_OVERRIDES = { walk: 'Walk', rest: 'Rest' };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function stepName(step) {
    const label = typeof step.label === 'string' ? step.label.trim().toLowerCase() : '';
    return LABEL_OVERRIDES[label] || KIND_LABELS[step.kind] || 'Other';
  }

  function formatDuration(duration) {
    if (!duration) return '';
    if (duration.unit === 'distance') {
      const meters = duration.meters;
      if (meters < 1000) return `${meters} m`;
      return `${Number((meters / 1000).toFixed(2))} km`;
    }
    const seconds = duration.seconds;
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours} h${mins ? ` ${mins} min` : ''}${rest ? ` ${rest} s` : ''}`;
    }
    return `${minutes} min${rest ? ` ${rest} s` : ''}`;
  }

  function pace(seconds) {
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  /** "5:30-5:45 /km", "5:30 /km" for an exact pace, or "" when there is no target. */
  function formatPaceRange(target) {
    if (!target || target.kind !== 'pace') return '';
    const low = Math.min(target.minSecPerKm, target.maxSecPerKm);
    const high = Math.max(target.minSecPerKm, target.maxSecPerKm);
    return low === high ? `${pace(low)} /km` : `${pace(low)}-${pace(high)} /km`;
  }

  function formatDateLabel(localDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate || '');
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  }

  function stepHtml(step) {
    const name = stepName(step);
    const extra = typeof step.label === 'string' && step.label.trim() && step.label.trim().toLowerCase() !== name.toLowerCase() && !LABEL_OVERRIDES[step.label.trim().toLowerCase()]
      ? `<span class="wk-extra">${esc(step.label.trim())}</span>` : '';
    const paceText = formatPaceRange(step.target);
    return `<li class="wk-step"><span class="wk-name">${esc(name)}</span><span class="wk-dur">${esc(formatDuration(step.duration))}</span>`
      + `<span class="wk-pace${paceText ? '' : ' is-open'}">${paceText ? esc(paceText) : 'No target'}</span>${extra}</li>`;
  }

  function blocksHtml(blocks, nested) {
    const items = (Array.isArray(blocks) ? blocks : []).map((block) => {
      if (block.kind === 'repeat') {
        const label = typeof block.label === 'string' && block.label.trim() ? ` <span class="wk-extra">${esc(block.label.trim())}</span>` : '';
        return `<li class="wk-repeat"><span class="wk-repeat-head">Repeat ${esc(block.repetitions)}x${label}</span>${blocksHtml(block.steps, true)}</li>`;
      }
      return stepHtml(block);
    });
    return `<ol class="wk-steps${nested ? ' wk-nested' : ''}">${items.join('')}</ol>`;
  }

  /** Title, "Sun 25 Oct · Long Run", then steps. Coaching notes are deliberately not shown. */
  function renderWorkout(workout, options = {}) {
    const meta = [formatDateLabel(workout.schedule?.localDate), workout.workoutType].filter(Boolean).join(' · ');
    return `${options.omitTitle ? '' : `<div class="wk-title">${esc(workout.title || 'Untitled workout')}</div>`}`
      + `<div class="wk-meta">${esc(meta)}</div>${blocksHtml(workout.blocks)}`;
  }

  /** Today's date (YYYY-MM-DD) in the workout's own timezone. */
  function localToday(timezone, now) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    } catch {
      return now.toLocaleDateString('en-CA');
    }
  }

  /**
   * A workout counts as done when another run exists on its scheduled date. Runs come from the
   * editor's existing activity list (`{ sourceActivityId, sessionDate }`), so a workout scheduled
   * for today stays open until a run for today has actually been recorded.
   */
  function isWorkoutCompleted(workout, runs) {
    const date = workout.schedule?.localDate;
    const sourceId = workout.sourceSession?.sourceActivityId;
    return (runs || []).some((run) => run.sessionDate === date && run.sourceActivityId !== sourceId);
  }

  /**
   * Splits stored workouts into `actions` (upcoming, still needing approval or a sync) and `next`
   * (the nearest upcoming workout that is approved and synced). Past and completed workouts, and
   * rejected or superseded ones, appear in neither.
   */
  function selectUpcomingWorkouts(records, runs, now = new Date()) {
    const actions = [];
    let next = null;
    for (const record of records || []) {
      const workout = record.workout || {};
      const lifecycle = workout.lifecycle || {};
      const date = String(workout.schedule?.localDate || '');
      if (lifecycle.approvalStatus === 'rejected' || lifecycle.approvalStatus === 'superseded') continue;
      if (!date || date < localToday(workout.schedule?.timezone, now)) continue;
      if (isWorkoutCompleted(workout, runs)) continue;
      if (lifecycle.approvalStatus === 'approved' && lifecycle.syncStatus === 'synced') {
        if (!next || date < next.workout.schedule.localDate) next = record;
      } else {
        actions.push(record);
      }
    }
    actions.sort((a, b) => String(a.workout.schedule.localDate).localeCompare(String(b.workout.schedule.localDate)));
    return { actions, next };
  }

  return { stepName, formatDuration, formatPaceRange, formatDateLabel, renderWorkout, blocksHtml, localToday, isWorkoutCompleted, selectUpcomingWorkouts };
}));
