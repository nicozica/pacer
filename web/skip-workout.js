/* Home screen entry point for Skip Workout: the "Skip workout…" link beside the Next workout panel.
 * It only navigates to /skip/; skipped-workout history lives behind its dedicated URLs, not on the home screen. */
(function skipWorkoutUi() {
  'use strict';

  const pageUrl = (id) => `/skip/?id=${encodeURIComponent(id)}`;

  /** Link for stored, approved, unskipped, not-syncing workouts. */
  function renderTargetAction(target) {
    const host = document.getElementById('workout-skip-actions');
    if (!host) return;
    const record = target?.record;
    const lifecycle = record?.workout?.lifecycle;
    const eligible = Boolean(record) && !record.skip && lifecycle?.approvalStatus === 'approved'
      && !target.superseded && lifecycle.syncStatus !== 'syncing';
    host.classList.toggle('hidden', !eligible);
    host.innerHTML = eligible
      ? `<a class="skip-link" data-skip-action="open" href="${pageUrl(record.workout.pacerWorkoutId)}">Skip workout…</a>`
      : '';
  }

  window.PacerSkip = { renderTargetAction };
}());
