/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

let currentSummary = null;
let currentWeather = '—';

const WEATHER_CODE_LABELS = {
  0: 'clear',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'cloudy',
  45: 'fog',
  48: 'fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'dense drizzle',
  56: 'freezing drizzle',
  57: 'freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'rain showers',
  81: 'rain showers',
  82: 'heavy rain showers',
  85: 'snow showers',
  86: 'snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm',
  99: 'thunderstorm',
};

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function buildRefreshFallbackMessage() {
  const lastSuccessful = formatTimestamp(currentSummary?.fetchedAt ?? '');
  if (!lastSuccessful) {
    return 'Refresh failed. No successful data is available yet.';
  }
  return `Refresh failed. Showing last successful data. Last successful update: ${lastSuccessful}.`;
}

function isAuthRefreshErrorMessage(msg) {
  const normalized = (msg || '').toLowerCase();
  return normalized.includes('strava authentication failed')
    || normalized.includes('no strava tokens')
    || normalized.includes('re-authenticate')
    || normalized.includes('401')
    || normalized.includes('403');
}

function buildRefreshErrorMessage(err) {
  const fallback = buildRefreshFallbackMessage();
  const rawMessage = err instanceof Error ? err.message : '';
  if (!isAuthRefreshErrorMessage(rawMessage)) return fallback;
  return `${fallback} Re-authenticate with: npm run strava:auth`;
}

function parseIsoTimestamp(isoString) {
  if (!isoString) return NaN;
  const hasTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(isoString);
  const normalized = hasTimezone ? isoString : `${isoString}Z`;
  return Date.parse(normalized);
}

function weatherLabel(code) {
  return WEATHER_CODE_LABELS[code] ?? 'unknown';
}

function formatWeatherLine(tempC, code, windKmh) {
  const parts = [];
  if (typeof tempC === 'number') parts.push(`${Math.round(tempC)}°C`);
  if (typeof code === 'number') parts.push(weatherLabel(code));
  if (typeof windKmh === 'number') parts.push(`wind ${Math.round(windKmh)} km/h`);
  return parts.length > 0 ? parts.join(' | ') : '—';
}

function resolveWeatherCoords(summary) {
  const activity = summary?.latestActivity;
  if (!activity) return { lat: null, lon: null };

  const lat = typeof activity.startLat === 'number'
    ? activity.startLat
    : summary.weatherDefaultLat;
  const lon = typeof activity.startLon === 'number'
    ? activity.startLon
    : summary.weatherDefaultLon;

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return { lat: null, lon: null };
  }

  return { lat, lon };
}

function pickClosestHourlyIndex(hourlyTimes, targetTs) {
  if (!Array.isArray(hourlyTimes) || Number.isNaN(targetTs)) return -1;
  let bestIndex = -1;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (let i = 0; i < hourlyTimes.length; i += 1) {
    const hourTs = parseIsoTimestamp(hourlyTimes[i]);
    if (Number.isNaN(hourTs)) continue;
    const diff = Math.abs(hourTs - targetTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }

  return bestIndex;
}

async function loadWeatherForLatestActivity(summary) {
  if (typeof summary?.latestActivityTempC === 'number') {
    return `${Math.round(summary.latestActivityTempC)}°C`;
  }

  const activity = summary?.latestActivity;
  if (!activity?.startDateUtc) return '—';

  const { lat, lon } = resolveWeatherCoords(summary);
  if (lat === null || lon === null) return '—';

  const day = activity.startDateUtc.slice(0, 10);
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('start_date', day);
  url.searchParams.set('end_date', day);
  url.searchParams.set('hourly', 'temperature_2m,weather_code,wind_speed_10m');
  url.searchParams.set('timezone', 'UTC');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return '—';
    const data = await res.json();
    const hourly = data?.hourly;
    const idx = pickClosestHourlyIndex(hourly?.time, parseIsoTimestamp(activity.startDateUtc));
    if (idx < 0) return '—';

    const temp = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m[idx] : undefined;
    const code = Array.isArray(hourly?.weather_code) ? hourly.weather_code[idx] : undefined;
    const wind = Array.isArray(hourly?.wind_speed_10m) ? hourly.wind_speed_10m[idx] : undefined;
    return formatWeatherLine(temp, code, wind);
  } catch {
    return '—';
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Data loading                                                         */
/* ------------------------------------------------------------------ */

async function loadLatest() {
  const res = await fetch('/api/latest', { cache: 'no-store' });
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
    currentWeather = await loadWeatherForLatestActivity(currentSummary);
    updateBrief();
  } catch (err) {
    showError(buildRefreshErrorMessage(err));
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
  const formattedFetchedAt = formatTimestamp(fetchedAt);
  updatedEl.textContent = fetchedAt
    ? `Last updated: ${formattedFetchedAt || fetchedAt}`
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

function lapText(lap) {
  const baseLabel = lap.name && lap.name !== `Lap ${lap.lap}`
    ? `${lap.name} (Lap ${lap.lap})`
    : `Lap ${lap.lap}`;
  const parts = [];
  if (lap.distanceKm) parts.push(`${lap.distanceKm} km`);
  parts.push(lap.durationFormatted);
  if (lap.pace) parts.push(`pace ${lap.pace}`);
  if (lap.avgHR) parts.push(`HR ${lap.avgHR}`);
  return `${baseLabel}: ${parts.join(' | ')}`;
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
  lines.push('--- HOW I FELT (LAST SESSION) ---');
  lines.push(`Session type: ${val('session-type') || '—'}`);
  lines.push(`Legs: ${val('legs') || '—'}`);
  const sleepScore = val('sleep-score');
  const restedness = val('restedness');
  lines.push(`Sleep: score ${sleepScore ? `${sleepScore}/100` : '—'} | restedness ${restedness || '—'}`);
  lines.push(`Extra notes: ${val('notes') || '—'}`);
  lines.push(`Files: ${isChecked('tcx-attached') ? 'TCX attached' : 'TCX not attached'}`);

  lines.push('');
  lines.push('--- WEATHER ---');
  lines.push(`Weather: ${currentWeather || '—'}`);

  lines.push('');
  lines.push('--- LAPS ---');
  const laps = Array.isArray(currentSummary?.latestActivityLaps) ? currentSummary.latestActivityLaps : [];
  if (laps.length === 0) {
    lines.push('Laps: —');
  } else {
    laps.forEach((lap) => lines.push(lapText(lap)));
  }

  return lines.join('\n');
}

function val(id) {
  return document.getElementById(id).value.trim();
}

function isChecked(id) {
  const el = document.getElementById(id);
  return Boolean(el && el.checked);
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

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  const copied = document.execCommand('copy');
  document.body.removeChild(ta);
  return copied;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy copy path
    }
  }
  return fallbackCopyText(text);
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

document.getElementById('btn-refresh').addEventListener('click', refreshFromStrava);

document.getElementById('btn-copy').addEventListener('click', async () => {
  const text = document.getElementById('brief-preview').value;
  const btn = document.getElementById('btn-copy');
  const copied = await copyText(text);
  if (!copied) {
    btn.textContent = 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy to clipboard'; }, 2000);
    return;
  }
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
[
  'session-type',
  'legs',
  'sleep-score',
  'restedness',
  'notes',
].forEach((id) => {
  document.getElementById(id).addEventListener('input', updateBrief);
});
document.getElementById('tcx-attached').addEventListener('change', updateBrief);

/* ------------------------------------------------------------------ */
/* Init                                                                 */
/* ------------------------------------------------------------------ */

(async () => {
  try {
    currentSummary = await loadLatest();
    renderData();
    currentWeather = await loadWeatherForLatestActivity(currentSummary);
  } catch (err) {
    showError(`Could not load activity data: ${err.message}`);
    document.getElementById('last-updated').textContent = 'No data loaded';
  }
  updateBrief();
})();
