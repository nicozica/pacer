/* Stored-workout list with explicit Approve and Sync actions. Import happens only
 * through the unified Coachat save in app.js, which calls window.PacerWorkouts.reload(). */
(function futureWorkoutUi() {
  'use strict';

  const status = document.getElementById('future-workout-status');
  const list = document.getElementById('future-workout-list');
  const heading = document.getElementById('workouts-heading');
  let highlightId = null;
  let cachedRecords = null;
  let knownRuns = null; // null until the editor reports recent runs; completion can't be judged before that
  let approvePendingId = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function setStatus(message, tone) {
    status.textContent = message;
    status.classList.remove('is-error', 'is-valid');
    if (tone === 'error') status.classList.add('is-error');
    if (tone === 'valid') status.classList.add('is-valid');
  }

  async function request(path, options) {
    const response = await fetch(path, options);
    let body = {};
    try {
      body = await response.json();
    } catch {
      // The server's API responses are JSON; retain a useful error if this changes.
    }
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body;
  }

  function nextWorkoutRow(record) {
    const workout = record.workout;
    return `<div class="next-workout${record.workout.pacerWorkoutId === highlightId ? ' is-new' : ''}">
      <div class="next-workout-main">
        <span class="next-workout-title">${escapeHtml(workout.title || 'Untitled workout')}</span>
        <span class="next-workout-date">${escapeHtml(window.PacerWorkoutFormat.formatDateLabel(workout.schedule?.localDate))}</span>
      </div>
      <span class="future-workout-badge is-approved">Synced to Intervals.icu</span>
    </div>`;
  }

  function render(records) {
    cachedRecords = records;
    if (!Array.isArray(records)) return;
    if (knownRuns === null) {
      list.innerHTML = '<p class="empty">Loading workouts…</p>';
      return;
    }

    const { actions, next } = window.PacerWorkoutFormat.selectUpcomingWorkouts(records, knownRuns);
    heading.textContent = actions.length > 0 ? 'Approve and sync' : 'Next workout';
    if (actions.length === 0 && !next) {
      list.innerHTML = '<p class="future-workout-empty">No upcoming workout scheduled.</p>';
      return;
    }
    const visible = actions;
    list.innerHTML = visible.map((record) => {
      const workout = record.workout || {};
      const lifecycle = workout.lifecycle || {};
      const approved = lifecycle.approvalStatus === 'approved';
      const id = String(workout.pacerWorkoutId || '');
      const synced = lifecycle.syncStatus === 'synced';
      const syncing = lifecycle.syncStatus === 'syncing';
      const badge = synced ? 'Synced' : approved ? 'Approved' : (lifecycle.approvalStatus || 'unknown');
      const revision = workout.proposalRevision > 1 ? `Revision ${escapeHtml(workout.proposalRevision)}` : '';
      const button = approved
        ? (synced
          ? '<span class="future-workout-sync-note">On your Intervals.icu calendar.</span>'
          : `<button class="button-primary" data-sync-workout="${escapeHtml(id)}" ${syncing || approvePendingId === id ? 'disabled' : ''}>${syncing ? 'Syncing…' : lifecycle.syncStatus === 'failed' ? 'Retry sync' : 'Sync to Intervals.icu'}</button><span class="future-workout-sync-note">${lifecycle.lastSyncError ? escapeHtml(lifecycle.lastSyncError) : 'Not on the calendar yet.'}</span>`)
        : `<button class="button-primary" data-approve-workout="${escapeHtml(id)}" ${approvePendingId === id ? 'disabled' : ''}>${approvePendingId === id ? 'Approving…' : 'Approve'}</button><span class="future-workout-sync-note">Approving does not schedule it.</span>`;
      return `<article class="future-workout-card${id === highlightId ? ' is-new' : ''}">
        <div class="future-workout-card-header">
          <div class="future-workout-title">${escapeHtml(workout.title || 'Untitled workout')}</div>
          <span class="future-workout-badge ${approved ? 'is-approved' : ''}">${escapeHtml(badge)}</span>
        </div>
        <div class="future-workout-preview">${window.PacerWorkoutFormat.renderWorkout(workout, { omitTitle: true })}${revision ? `<div class="wk-meta">${revision}</div>` : ''}</div>
        <div class="future-workout-controls">${button}</div>
      </article>`;
    }).join('') + (next ? nextWorkoutRow(next) : '');

    list.querySelectorAll('[data-approve-workout]').forEach((button) => {
      button.addEventListener('click', () => approve(button.dataset.approveWorkout));
    });
    list.querySelectorAll('[data-sync-workout]').forEach((button) => {
      button.addEventListener('click', () => synchronize(button.dataset.syncWorkout));
    });
  }

  async function load() {
    try {
      const response = await request('/api/workouts');
      render(response.proposals);
    } catch (error) {
      list.innerHTML = `<p class="error">Could not load future workout proposals: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function approve(id) {
    if (!id || approvePendingId) return;
    if (!window.confirm('Approve this workout? Approving does not add it to your calendar.')) return;
    approvePendingId = id;
    await load();
    try {
      await request(`/api/workouts/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      setStatus('Approved. Nothing was added to the calendar.', 'valid');
    } catch (error) {
      setStatus(error.message || 'Could not approve proposal.', 'error');
    } finally {
      approvePendingId = null;
      await load();
    }
  }

  async function synchronize(id) {
    if (!id || approvePendingId) return;
    if (!window.confirm('Sync this approved workout to Intervals.icu? This is a remote calendar write and does not change Garmin directly.')) return;
    approvePendingId = id;
    await load();
    try {
      const result = await request(`/api/workouts/${encodeURIComponent(id)}/sync`, { method: 'POST' });
      const lifecycle = result.proposal?.workout?.lifecycle || {};
      if (lifecycle.syncStatus === 'synced') setStatus('Synced to Intervals.icu.', 'valid');
      else setStatus(lifecycle.lastSyncError || 'Sync failed. Nothing was added to the calendar.', 'error');
    } catch (error) {
      setStatus(error.message || 'Could not synchronize workout.', 'error');
    } finally {
      approvePendingId = null;
      await load();
    }
  }

  window.PacerWorkouts = {
    // Reload the list; `highlight` is a proposal's pacerWorkoutId to mark as just imported.
    reload(highlight) { highlightId = highlight || null; return load(); },
    // Recent runs ({ sourceActivityId, sessionDate }) used to tell completed workouts from upcoming ones.
    setRuns(runs) { knownRuns = Array.isArray(runs) ? runs : []; if (cachedRecords) render(cachedRecords); },
  };
  // If the editor never reports its runs, fall back to date-only filtering rather than waiting forever.
  setTimeout(() => { if (knownRuns === null) window.PacerWorkouts.setRuns([]); }, 15000);
  load();
}());
