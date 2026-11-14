/* Shared Skip Workout helpers for the home screen and the /skip/ page: display formatting, the
 * recovery-snapshot view, the skip-context JSON for Coachat, and clipboard access. Display only:
 * every value comes from the backend, missing values are labelled "unavailable", never filled in. */
(function skipCommon() {
  'use strict';

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const fmt = () => window.PacerWorkoutFormat;

  async function request(url, options) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
    return body;
  }

  /* ---------- formatting (display only; no data is invented) ---------- */

  function plannedDuration(workout) {
    let seconds = 0;
    let distanceBased = false;
    const add = (step, times) => {
      if (step.duration?.unit === 'time') seconds += step.duration.seconds * times;
      else distanceBased = true;
    };
    for (const block of workout.blocks || []) {
      if (block.kind === 'repeat') (block.steps || []).forEach((step) => add(step, block.repetitions));
      else add(block, 1);
    }
    if (seconds <= 0) return distanceBased ? 'distance-based steps' : 'not specified';
    const label = fmt().formatDuration({ unit: 'time', seconds });
    return distanceBased ? `${label} + distance-based steps` : label;
  }

  function hoursMinutes(seconds) {
    if (typeof seconds !== 'number') return null;
    const minutes = Math.round(seconds / 60);
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  }

  function stamp(iso) {
    if (!iso) return 'unknown time';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  /* ---------- recovery summary ---------- */

  const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

  /** "HH:MM" from a provider local-time string (2026-11-14T01:12:00 / "2026-11-14 01:12"). */
  function clockOf(local, utc) {
    const m = typeof local === 'string' && local.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (m) return { date: m[1], time: m[2] };
    if (!utc) return null;
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
  }

  function sleepInterval(day) {
    const from = clockOf(day?.sleepStartLocal, day?.sleepStart);
    const to = clockOf(day?.sleepEndLocal, day?.sleepEnd);
    if (!from && !to) return null;
    const next = from && to && from.date !== to.date ? ' (next day)' : '';
    return `${from?.time ?? '?'} → ${to?.time ?? '?'}${next}`;
  }

  /**
   * One metric card. Garmin (g) and Intervals.icu (i) readings are merged: equal readings show once,
   * a difference shows both side by side, a single reading names its source, none shows "Unavailable".
   * `same` decides equality so rounding noise (seconds of sleep) is not reported as a conflict.
   */
  function metricCard(metric, label, g, i, show, same, sub) {
    const hasG = g != null; const hasI = i != null;
    let body; let source = '';
    if (hasG && hasI && !same(g, i)) {
      body = `<ul class="rec-split"><li><span>Garmin</span><strong>${esc(show(g))}</strong></li><li><span>Intervals.icu</span><strong>${esc(show(i))}</strong></li></ul>`
        + '<span class="rec-flag">Sources differ</span>';
    } else if (hasG || hasI) {
      body = `<strong class="rec-value">${esc(show(hasG ? g : i))}</strong>`;
      source = hasG && hasI ? 'Garmin and Intervals.icu agree' : hasG ? 'Garmin' : 'Intervals.icu';
    } else {
      body = '<strong class="rec-value is-unavailable">Unavailable</strong>';
    }
    const extra = [sub, source].filter(Boolean).map((t) => `<span class="rec-sub">${esc(t)}</span>`).join('');
    return `<div class="rec-card" data-metric="${metric}"><span class="rec-label">${esc(label)}</span>${body}${extra}</div>`;
  }

  /** Recovery summary from a stored/previewed snapshot. Missing values are labelled, never filled in. */
  function recoveryHtml(snapshot) {
    if (!snapshot) return '<p class="skip-note">No recovery snapshot was recorded.</p>';
    const av = snapshot.availability || {};
    const iDay = snapshot.intervals?.sessionDay || null;
    const recent = snapshot.intervals?.recent || null;
    const garmin = snapshot.garmin || null;
    const gDay = garmin?.sessionDay || null;
    const days = isNum(recent?.daysConsidered) && recent.daysConsidered > 0 ? `${recent.daysConsidered}-day` : 'Recent';
    const sameMinute = (x, y) => Math.abs(x - y) < 60; // seconds of drift are not a discrepancy
    const eq = (x, y) => x === y;

    const notes = [];
    if (av.garmin === 'stale') notes.push(`Garmin data is stale (fetched ${stamp(garmin?.fetchedAt)}).`);
    else if (!gDay) notes.push(`Garmin: ${{ not_enabled: 'not enabled', unavailable: `unavailable${garmin?.failureReason ? ` (${garmin.failureReason})` : ''}`, fresh: 'no data for this date', stale: 'stale' }[av.garmin] || 'unavailable'}.`);
    if (!iDay) notes.push(av.intervals === 'available' ? 'Intervals.icu: no wellness entry for this date.' : 'Intervals.icu: unavailable.');

    const cards = [
      metricCard('sleep', 'Sleep', gDay?.sleepDurationS, iDay?.sleepDurationS, hoursMinutes, sameMinute, sleepInterval(gDay)),
      metricCard('sleep-score', 'Sleep score', gDay?.sleepScore, iDay?.sleepScore, String, eq,
        isNum(recent?.averageSleepScore) ? `${days} avg ${Math.round(recent.averageSleepScore)}` : null),
      metricCard('body-battery', 'Body Battery (morning)', gDay?.bodyBatteryMorning, null, String, eq, null),
      metricCard('resting-hr', 'Resting HR', null, iDay?.restingHeartRate, (v) => `${v} bpm`, eq,
        isNum(recent?.averageRestingHeartRate) ? `${days} avg ${Math.round(recent.averageRestingHeartRate)} bpm` : null),
    ].join('');

    const secondary = [];
    if (isNum(recent?.averageSleepDurationS)) secondary.push(`${days} avg sleep ${hoursMinutes(recent.averageSleepDurationS)}`);
    const gh = gDay?.hrv ?? null; const ih = iDay?.hrv ?? null;
    if (gh != null && ih != null && gh !== ih) secondary.push(`HRV: Garmin ${gh}, Intervals.icu ${ih} (sources differ)`);
    else if (gh != null || ih != null) secondary.push(`HRV ${gh ?? ih} (${gh != null && ih != null ? 'Garmin and Intervals.icu' : gh != null ? 'Garmin' : 'Intervals.icu'})`);
    else secondary.push('HRV unavailable');

    const prov = [];
    prov.push(`<li><strong>Intervals.icu</strong> ${esc(snapshot.intervals?.provenance || 'no data')}${iDay?.updatedAt ? `; wellness updated ${esc(stamp(iDay.updatedAt))}` : ''}${snapshot.intervals?.fetchedAt ? `; fetched ${esc(stamp(snapshot.intervals.fetchedAt))}` : ''}</li>`);
    prov.push(`<li><strong>Garmin</strong> ${esc(garmin?.provenance || 'no data')}; ${esc(av.garmin || 'not_enabled')}${garmin?.fetchedAt ? `; fetched ${esc(stamp(garmin.fetchedAt))}` : ''}${gDay?.dataTimestamp ? `; daily data ${esc(stamp(gDay.dataTimestamp))}` : ''}</li>`);
    prov.push(`<li><strong>Collected</strong> ${esc(stamp(snapshot.collectedAt))}</li>`);

    return `<div class="rec">${notes.map((n) => `<p class="rec-note">${esc(n)}</p>`).join('')}`
      + `<div class="rec-grid">${cards}</div>`
      + `<p class="rec-secondary">${secondary.map(esc).join(' · ')}</p>`
      + `<details class="rec-prov"><summary>Sources and timestamps</summary><ul>${prov.join('')}</ul></details></div>`;
  }

  /** Whitelisted, display-level fields only: no key status, raw provider payloads or unrelated body data. */
  function pick(source, keys) {
    if (!source) return null;
    return Object.fromEntries(keys.map((key) => [key, source[key] ?? null]));
  }

  /** pacer-skip-context-v1: private context for ChatGPT/Coachat. Not a Pacer import contract. */
  function buildContext(details, options = {}) {
    const workout = details.workout;
    const skip = details.skip;
    const snapshot = skip?.wellnessSnapshot ?? details.recoveryPreview ?? null;
    const intervals = snapshot?.intervals ?? null;
    const garmin = snapshot?.garmin ?? null;
    const iDay = pick(intervals?.sessionDay, ['updatedAt', 'sleepDurationS', 'sleepScore', 'sleepQuality', 'restingHeartRate', 'hrv']);
    const gDay = pick(garmin?.sessionDay, ['dataTimestamp', 'sleepStart', 'sleepEnd', 'sleepStartLocal', 'sleepEndLocal', 'sleepDurationS', 'sleepScore', 'bodyBatteryMorning', 'hrv']);
    const unavailable = [];
    if (!intervals) unavailable.push('intervals: no wellness data');
    else if (!iDay) unavailable.push('intervals: no entry for the scheduled date');
    else Object.entries(iDay).forEach(([k, v]) => { if (v == null) unavailable.push(`intervals.${k}`); });
    if (!garmin) unavailable.push(`garmin: ${snapshot?.availability?.garmin ?? 'not enabled'}`);
    else if (!gDay) unavailable.push(`garmin: no session-day data (${garmin.availability})`);
    else Object.entries(gDay).forEach(([k, v]) => { if (v == null) unavailable.push(`garmin.${k}`); });
    if (!details.planningAnchor) unavailable.push('planningAnchor: no genuine completed activity available');
    return {
      contractVersion: 'pacer-skip-context-v1',
      purpose: 'Private context for evaluating recovery and recommending the next workout. Not a Pacer import contract.',
      skippedWorkout: {
        pacerWorkoutId: workout.pacerWorkoutId, title: workout.title, workoutType: workout.workoutType,
        scheduledDate: workout.schedule?.localDate ?? null, timezone: workout.schedule?.timezone ?? null,
        plannedDuration: plannedDuration(workout), blocks: workout.blocks,
      },
      // 'intended_skip_not_persisted' until the user confirms; then the stored outcome.
      status: skip ? details.outcomeStatus : (details.skipIntentStatus ?? details.outcomeStatus),
      skippedAt: skip?.skippedAt ?? null,
      explanation: skip ? (skip.explanation ?? null) : (options.explanation || null),
      completedAfterSkipActivityId: details.completedAfterSkipActivityId ?? null,
      recovery: {
        collectedAt: snapshot?.collectedAt ?? null,
        availability: snapshot?.availability ?? null,
        intervals: intervals ? { provenance: intervals.provenance, fetchedAt: intervals.fetchedAt ?? null, sessionDate: intervals.sessionDate, sessionDay: iDay, recent: intervals.recent ?? null } : null,
        garmin: garmin ? { provenance: garmin.provenance, availability: garmin.availability, fetchedAt: garmin.fetchedAt, lastSuccessfulFetch: garmin.lastSuccessfulFetch, failureReason: garmin.failureReason, sessionDay: gDay } : null,
      },
      planningAnchor: details.planningAnchor ?? null,
      unavailable,
    };
  }

  /** Brief (backend-generated) plus the context JSON, ready to paste into Coachat in one go. */
  function combinedText(details, options = {}) {
    const intended = !details.skip;
    return `${details.brief}\n\nSKIP CONTEXT JSON (pacer-skip-context-v1${intended ? '; intended skip, not yet recorded' : ''}):\n${JSON.stringify(buildContext(details, options), null, 2)}\n`;
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(ta);
    return copied;
  }
  async function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
    }
    return fallbackCopy(text);
  }

  window.PacerSkipCommon = { esc, request, plannedDuration, stamp, recoveryHtml, buildContext, combinedText, copy };
}());
