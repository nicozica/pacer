/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

let currentSummary = null;

/* ------------------------------------------------------------------ */
/* Data loading                                                         */
/* ------------------------------------------------------------------ */

async function loadLatest() {
  const res = await fetch('/api/latest');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to load data.');
  return data;
}

async function refreshFromStrava() {
  const btn = document.getElementById('btn-refresh');
  btn.disabled = true;
  btn.textContent = '↺ Refreshing…';
  hideError();

  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Refresh failed.');
    currentSummary = data;
    renderData();
    updateBrief();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '↺ Refresh from Strava';
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                            */
/* ------------------------------------------------------------------ */

function activityHtml(a) {
  if (!a) return '<span class="empty">None on record</span>';
  const rows = [
    `<strong>${a.name}</strong>`,
    `<span class="date">${a.type} · ${a.date}</span>`,
  ];
  if (a.distanceKm) rows.push(`Distance: ${a.distanceKm} km`);
  rows.push(`Duration: ${a.durationFormatted}`);
  if (a.pace)    rows.push(`Pace: ${a.pace}`);
  if (a.speedKmh) rows.push(`Speed: ${a.speedKmh} km/h`);
  if (a.avgHR)   rows.push(`HR: ${a.avgHR} avg${a.maxHR ? ` / ${a.maxHR} max` : ''} bpm`);
  if (a.elevationM) rows.push(`Elevation: +${a.elevationM} m`);
  return rows.join('<br>');
}

function renderData() {
  if (!currentSummary) return;
  const { fetchedAt, latestActivity, latestRun, latestRide, last7days: w } = currentSummary;

  const updatedEl = document.getElementById('last-updated');
  updatedEl.textContent = fetchedAt
    ? `Last updated: ${new Date(fetchedAt).toLocaleString()}`
    : 'No data yet — run npm run strava:fetch';

  document.getElementById('latest-content').innerHTML = activityHtml(latestActivity);
  document.getElementById('run-content').innerHTML    = activityHtml(latestRun);
  document.getElementById('ride-content').innerHTML   = activityHtml(latestRide);

  const totalH = Math.floor(w.totalTimeMin / 60);
  const totalM = w.totalTimeMin % 60;
  const timeStr = totalH > 0 ? `${totalH}h ${totalM}m` : `${totalM}m`;

  document.getElementById('week-summary').innerHTML =
    `<strong>Last 7 days:</strong> ${w.count} activities — ` +
    `${w.runCount} run${w.runCount !== 1 ? 's' : ''} (${w.totalRunKm} km), ` +
    `${w.rideCount} ride${w.rideCount !== 1 ? 's' : ''} (${w.totalRideKm} km) — ` +
    `Total time: ${timeStr}`;
}

/* ------------------------------------------------------------------ */
/* Brief generation                                                     */
/* ------------------------------------------------------------------ */

function activityText(label, a) {
  if (!a) return `${label}: none on record`;
  const lines = [`${label}: ${a.name} (${a.type}) — ${a.date}`];
  if (a.distanceKm) lines.push(`  Distance: ${a.distanceKm} km`);
  lines.push(`  Duration: ${a.durationFormatted}`);
  if (a.pace)     lines.push(`  Pace: ${a.pace}`);
  if (a.speedKmh) lines.push(`  Speed: ${a.speedKmh} km/h`);
  if (a.avgHR)    lines.push(`  HR: ${a.avgHR} avg${a.maxHR ? ` / ${a.maxHR} max` : ''} bpm`);
  if (a.elevationM) lines.push(`  Elevation: +${a.elevationM} m`);
  return lines.join('\n');
}

function buildBriefText() {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`== TRAINING BRIEF — ${today} ==`, ''];

  if (currentSummary) {
    const { latestActivity, latestRun, latestRide, last7days: w, fetchedAt } = currentSummary;

    lines.push('--- RECENT ACTIVITY ---');
    lines.push(activityText('Latest activity', latestActivity));

    if (latestRun) {
      lines.push('');
      lines.push(activityText('Latest run', latestRun));
    }
    if (latestRide) {
      lines.push('');
      lines.push(activityText('Latest ride', latestRide));
    }

    lines.push('');
    lines.push('--- LAST 7 DAYS ---');
    const totalH = Math.floor(w.totalTimeMin / 60);
    const totalM = w.totalTimeMin % 60;
    const timeStr = totalH > 0 ? `${totalH}h ${totalM}m` : `${totalM}m`;
    lines.push(`Activities: ${w.count} total | Runs: ${w.runCount} (${w.totalRunKm} km) | Rides: ${w.rideCount} (${w.totalRideKm} km)`);
    lines.push(`Total training time: ${timeStr}`);
    if (fetchedAt) lines.push(`Data as of: ${new Date(fetchedAt).toLocaleString()}`);
  } else {
    lines.push('(No activity data — run `npm run strava:fetch` first)');
  }

  lines.push('');
  lines.push('--- HOW I FEEL ---');
  lines.push(`General feeling: ${val('feeling') || '—'}`);
  lines.push(`Legs: ${val('legs') || '—'}`);
  lines.push(`Pain/discomfort: ${val('pain') || 'none'}`);
  lines.push(`Sleep: ${val('sleep') || '—'}`);

  lines.push('');
  lines.push('--- TOMORROW ---');
  lines.push(`Available time: ${val('time-tomorrow') || '—'}`);
  lines.push(`Goal: ${val('goal') || '—'}`);

  const notes = val('notes');
  if (notes) {
    lines.push('');
    lines.push('--- NOTES ---');
    lines.push(notes);
  }

  return lines.join('\n');
}

function val(id) {
  return document.getElementById(id).value.trim();
}

function updateBrief() {
  document.getElementById('brief-preview').value = buildBriefText();
}

/* ------------------------------------------------------------------ */
/* Error banner                                                         */
/* ------------------------------------------------------------------ */

function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError() {
  document.getElementById('error-banner').classList.add('hidden');
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

document.getElementById('btn-refresh').addEventListener('click', refreshFromStrava);

document.getElementById('btn-copy').addEventListener('click', async () => {
  const text = document.getElementById('brief-preview').value;
  await navigator.clipboard.writeText(text);
  const btn = document.getElementById('btn-copy');
  btn.textContent = '✓ Copied!';
  setTimeout(() => { btn.textContent = 'Copy to clipboard'; }, 2000);
});

document.getElementById('btn-download').addEventListener('click', () => {
  const text = document.getElementById('brief-preview').value;
  const today = new Date().toISOString().slice(0, 10);
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pacer-brief-${today}.txt`;
  a.click();
});

// Live brief update on any form change
['feeling', 'legs', 'pain', 'sleep', 'time-tomorrow', 'goal', 'notes'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateBrief);
});

/* ------------------------------------------------------------------ */
/* Init                                                                 */
/* ------------------------------------------------------------------ */

(async () => {
  try {
    currentSummary = await loadLatest();
    renderData();
  } catch (err) {
    showError(`Could not load activity data: ${err.message}`);
    document.getElementById('last-updated').textContent = 'No data loaded';
  }
  updateBrief();
})();
