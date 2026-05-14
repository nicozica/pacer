/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

let currentSummary = null;
let currentWeather = '—';
let currentEditorBootstrap = null;
let currentEditorSession = null;
let currentAiImport = null;

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

const SESSION_TYPES = new Set([
  'Easy Run',
  'Long Run',
  'Hills',
  'Interval Session',
  'Race',
  'Recovery Run',
  'Strides',
  'Tempo Session',
  'Time Trial',
]);

const FORM_INPUT_IDS = [
  'session-type',
  'legs',
  'sleep-score',
  'restedness',
  'notes',
  'tcx-attached',
];

/* ------------------------------------------------------------------ */
/* Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function formatDuration(seconds) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0) return '—';

  const hours = Math.floor(numeric / 3600);
  const minutes = Math.floor((numeric % 3600) / 60);
  const remainingSeconds = Math.floor(numeric % 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
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

function formatSecondsPerKm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '—';
  const min = Math.floor(numeric / 60);
  const sec = Math.round(numeric % 60);
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}

function val(id) {
  return document.getElementById(id).value.trim();
}

function isChecked(id) {
  const el = document.getElementById(id);
  return Boolean(el && el.checked);
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function setChecked(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = Boolean(checked);
}

function setLastUpdatedMessage(message) {
  const updatedEl = document.getElementById('last-updated');
  updatedEl.textContent = message;
}

function toOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function defaultTcxFilename() {
  if (!currentEditorSession) return '';
  const { selectedSourceActivityId, source } = currentEditorSession;
  return `pacer-${source.sessionDate}-${selectedSourceActivityId}.tcx`;
}

function defaultBriefFilename() {
  if (!currentEditorSession) return '';
  const { selectedSourceActivityId, source } = currentEditorSession;
  return `pacer-${source.sessionDate}-${selectedSourceActivityId}-brief.txt`;
}

function blankAiInput() {
  return {
    signalTitle: '',
    signalParagraphs: [],
    carryForward: '',
    nextRunTitle: '',
    nextRunSummary: '',
    nextRunDurationMin: null,
    nextRunDurationMax: null,
    nextRunDistanceKm: null,
    nextRunPaceMinSecPerKm: null,
    nextRunPaceMaxSecPerKm: null,
    nextRunWorkout: null,
    weekTitle: '',
    weekSummary: '',
  };
}

function hasAiContent(ai) {
  return Boolean(
    ai.signalTitle ||
    ai.signalParagraphs.length > 0 ||
    ai.carryForward ||
    ai.nextRunTitle ||
    ai.nextRunSummary ||
    ai.nextRunWorkout ||
    ai.weekTitle ||
    ai.weekSummary,
  );
}

function summarizeAiForLog(ai) {
  const normalized = ai ?? blankAiInput();
  return {
    hasContent: hasAiContent(normalized),
    signalTitle: normalized.signalTitle || '',
    signalParagraphCount: Array.isArray(normalized.signalParagraphs) ? normalized.signalParagraphs.length : 0,
    carryForward: Boolean(normalized.carryForward),
    nextRunTitle: normalized.nextRunTitle || '',
    nextRunWorkout: normalized.nextRunWorkout?.type || '',
    weekTitle: normalized.weekTitle || '',
  };
}

function serializeAiInput(ai) {
  if (!ai || !hasAiContent(ai)) return '';
  return JSON.stringify({
    signalTitle: ai.signalTitle,
    signalParagraphs: ai.signalParagraphs,
    carryForward: ai.carryForward,
    nextRunTitle: ai.nextRunTitle,
    nextRunSummary: ai.nextRunSummary,
    nextRunDurationMin: ai.nextRunDurationMin,
    nextRunDurationMax: ai.nextRunDurationMax,
    nextRunDistanceKm: ai.nextRunDistanceKm,
    nextRunPaceMinSecPerKm: ai.nextRunPaceMinSecPerKm,
    nextRunPaceMaxSecPerKm: ai.nextRunPaceMaxSecPerKm,
    nextRunWorkout: ai.nextRunWorkout,
    weekTitle: ai.weekTitle,
    weekSummary: ai.weekSummary,
  }, null, 2);
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function readAiJsonField(payload, camelKey) {
  if (Object.prototype.hasOwnProperty.call(payload, camelKey)) {
    return payload[camelKey];
  }

  const snakeKey = camelToSnake(camelKey);
  if (Object.prototype.hasOwnProperty.call(payload, snakeKey)) {
    return payload[snakeKey];
  }

  return undefined;
}

function normalizeAiText(value, label) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  throw new Error(`Field "${label}" must be a string.`);
}

function normalizeAiNumber(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  throw new Error(`Field "${label}" must be a number or null.`);
}

function normalizeAiParagraphs(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (value === undefined || value === null) return [];

  if (typeof value !== 'string') {
    throw new Error('Field "signalParagraphs" must be a string array or multiline string.');
  }

  const normalized = value
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (normalized.length > 0) {
    return normalized;
  }

  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeNextRunWorkout(value) {
  if (value === undefined || value === null || value === '') return null;

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Field "nextRunWorkout" must be an object or null.');
  }

  const type = normalizeAiText(value.type, 'nextRunWorkout.type');
  if (!SESSION_TYPES.has(type)) {
    throw new Error(`Field "nextRunWorkout.type" must be one of: ${Array.from(SESSION_TYPES).join(', ')}.`);
  }

  if (!Array.isArray(value.blocks)) {
    throw new Error('Field "nextRunWorkout.blocks" must be an array of strings.');
  }

  const blocks = value.blocks
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trimEnd())
    .filter((entry) => entry.trim());

  if (blocks.length === 0) {
    throw new Error('Field "nextRunWorkout.blocks" must include at least one block.');
  }

  return { type, blocks };
}

function getJsonErrorLocation(text, position) {
  if (!Number.isInteger(position) || position < 0) return '';

  const beforeError = text.slice(0, position);
  const line = beforeError.split('\n').length;
  const lastNewline = beforeError.lastIndexOf('\n');
  const column = position - lastNewline;

  return `line ${line}, column ${column}`;
}

function formatJsonParseError(err, text) {
  const message = err instanceof Error && err.message
    ? err.message
    : 'Unknown JSON parse error';
  const positionMatch = message.match(/position (\d+)/);
  const location = positionMatch
    ? getJsonErrorLocation(text, Number(positionMatch[1]))
    : '';

  if (!location || /\bline\b/i.test(message)) {
    return `JSON could not be parsed: ${message}`;
  }

  return `JSON could not be parsed at ${location}: ${message}`;
}

function parseAiJsonText(text) {
  if (!text.trim()) return blankAiInput();

  let payload;

  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(formatJsonParseError(err, text));
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AI JSON must be an object.');
  }

  return {
    signalTitle: normalizeAiText(readAiJsonField(payload, 'signalTitle'), 'signalTitle'),
    signalParagraphs: normalizeAiParagraphs(readAiJsonField(payload, 'signalParagraphs')),
    carryForward: normalizeAiText(readAiJsonField(payload, 'carryForward'), 'carryForward'),
    nextRunTitle: normalizeAiText(readAiJsonField(payload, 'nextRunTitle'), 'nextRunTitle'),
    nextRunSummary: normalizeAiText(readAiJsonField(payload, 'nextRunSummary'), 'nextRunSummary'),
    nextRunDurationMin: normalizeAiNumber(readAiJsonField(payload, 'nextRunDurationMin'), 'nextRunDurationMin'),
    nextRunDurationMax: normalizeAiNumber(readAiJsonField(payload, 'nextRunDurationMax'), 'nextRunDurationMax'),
    nextRunDistanceKm: normalizeAiNumber(readAiJsonField(payload, 'nextRunDistanceKm'), 'nextRunDistanceKm'),
    nextRunPaceMinSecPerKm: normalizeAiNumber(readAiJsonField(payload, 'nextRunPaceMinSecPerKm'), 'nextRunPaceMinSecPerKm'),
    nextRunPaceMaxSecPerKm: normalizeAiNumber(readAiJsonField(payload, 'nextRunPaceMaxSecPerKm'), 'nextRunPaceMaxSecPerKm'),
    nextRunWorkout: normalizeNextRunWorkout(readAiJsonField(payload, 'nextRunWorkout')),
    weekTitle: normalizeAiText(readAiJsonField(payload, 'weekTitle'), 'weekTitle'),
    weekSummary: normalizeAiText(readAiJsonField(payload, 'weekSummary'), 'weekSummary'),
  };
}

function setAiImportStatus(message, tone = 'neutral') {
  const status = document.getElementById('ai-import-status');
  status.textContent = message;
  status.classList.remove('is-error', 'is-valid');
  if (tone === 'error') status.classList.add('is-error');
  if (tone === 'valid') status.classList.add('is-valid');
}

function renderAiPreview(ai) {
  const preview = document.getElementById('ai-preview');

  if (!ai || !hasAiContent(ai)) {
    preview.innerHTML = '<p class="empty">No AI interpretation imported.</p>';
    return;
  }

  preview.innerHTML = [
    `<p class="ai-preview-row"><strong>Signal:</strong> ${escapeHtml(ai.signalTitle || '—')}</p>`,
    `<p class="ai-preview-row"><strong>Next run:</strong> ${escapeHtml(ai.nextRunTitle || '—')}</p>`,
    ai.nextRunWorkout
      ? `<p class="ai-preview-row"><strong>Workout:</strong> ${escapeHtml(ai.nextRunWorkout.type)} · ${escapeHtml(String(ai.nextRunWorkout.blocks.length))} blocks</p>`
      : '',
    `<p class="ai-preview-row"><strong>Week:</strong> ${escapeHtml(ai.weekTitle || '—')}</p>`,
  ].filter(Boolean).join('');
}

function syncAiImport(rawText, options = {}) {
  const text = typeof rawText === 'string' ? rawText : '';
  const textarea = document.getElementById('ai-json-input');
  if (textarea && textarea.value !== text) {
    textarea.value = text;
  }

  const emptyState = {
    rawText: '',
    parsedAi: blankAiInput(),
    isValid: true,
    hasContent: false,
    error: '',
  };

  if (!text.trim()) {
    currentAiImport = emptyState;
    renderAiPreview(currentAiImport.parsedAi);
    setAiImportStatus(options.emptyMessage ?? 'Paste the JSON returned by ChatGPT or upload a `.json` file.');
    return currentAiImport;
  }

  try {
    const parsedAi = parseAiJsonText(text);
    currentAiImport = {
      rawText: text,
      parsedAi,
      isValid: true,
      hasContent: hasAiContent(parsedAi),
      error: '',
    };
    renderAiPreview(parsedAi);
    setAiImportStatus(
      options.validMessage ?? (currentAiImport.hasContent ? 'AI JSON ready.' : 'JSON parsed, but it does not contain AI fields yet.'),
      'valid',
    );
    return currentAiImport;
  } catch (err) {
    currentAiImport = {
      rawText: text,
      parsedAi: blankAiInput(),
      isValid: false,
      hasContent: false,
      error: err.message || 'Invalid AI JSON.',
    };
    renderAiPreview(currentAiImport.parsedAi);
    setAiImportStatus(`Invalid AI JSON: ${currentAiImport.error}`, 'error');
    return currentAiImport;
  }
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError() {
  document.getElementById('error-banner').classList.add('hidden');
}

function showNotice(msg) {
  const el = document.getElementById('save-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideNotice() {
  document.getElementById('save-banner').classList.add('hidden');
}

function setButtonsDisabled(disabled) {
  ['btn-save', 'btn-save-publish', 'btn-copy', 'btn-download'].forEach((id) => {
    document.getElementById(id).disabled = disabled;
  });
}

async function fetchJson(url, options = {}) {
  const method = options.method ?? 'GET';
  console.info(`[Pacer UI] ${method} ${url} request`);
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  console.info(`[Pacer UI] ${method} ${url} response`, {
    status: res.status,
    ok: res.ok,
    body: data,
  });
  if (!res.ok) {
    console.error(`[Pacer UI] ${method} ${url} failed`, {
      status: res.status,
      body: data,
    });
    throw new Error(data.error ?? 'Request failed.');
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Weather helpers                                                    */
/* ------------------------------------------------------------------ */

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

function resolveSelectedWeatherLine() {
  const selectedLine = currentEditorSession?.source?.weatherLine;
  if (selectedLine) return selectedLine;

  const selectedId = currentEditorSession?.selectedSourceActivityId;
  const latestRunId = currentSummary?.latestRun?.sourceActivityId;
  if (selectedId && latestRunId && selectedId === latestRunId && currentWeather !== '—') {
    return currentWeather;
  }

  return '—';
}

/* ------------------------------------------------------------------ */
/* Summary data                                                       */
/* ------------------------------------------------------------------ */

async function loadLatest() {
  return fetchJson('/api/latest', { cache: 'no-store' });
}

async function loadSummaryState(refresh = false) {
  const summary = refresh
    ? await fetchJson('/api/refresh', { method: 'POST' })
    : await loadLatest();

  currentSummary = summary;
  renderData();
  currentWeather = await loadWeatherForLatestActivity(currentSummary);
  renderSourceCard();
  updateBrief();
}

async function hydrateAppState(options = {}) {
  const { refresh = false, sourceActivityId = null } = options;
  await loadSummaryState(refresh);
  await reloadEditorState(sourceActivityId);
  renderSourceCard();
  updateBrief();
}

async function refreshFromStrava(options = {}) {
  const { updateButton = true, showFetchError = true } = options;
  const btn = document.getElementById('btn-refresh');
  const selectedSourceActivityId = currentEditorSession?.selectedSourceActivityId ?? null;
  const previousLastUpdated = document.getElementById('last-updated').textContent;

  if (updateButton) {
    btn.disabled = true;
    btn.textContent = '↺ Refreshing…';
  }

  hideError();
  setLastUpdatedMessage('Refreshing from Strava…');

  try {
    await hydrateAppState({
      refresh: true,
      sourceActivityId: selectedSourceActivityId,
    });
  } catch (err) {
    if (document.getElementById('last-updated').textContent === 'Refreshing from Strava…') {
      setLastUpdatedMessage(previousLastUpdated || 'No data loaded');
    }
    if (showFetchError) {
      showError(err.message || 'Refresh failed.');
    }
    throw err;
  } finally {
    if (updateButton) {
      btn.disabled = false;
      btn.textContent = '↺ Refresh from Strava';
    }
  }
}

function activityHtml(activity, options = {}) {
  const {
    hideSpeed = false,
    hideElevation = false,
  } = options;

  if (!activity) return '<span class="empty">None on record</span>';

  const rows = [
    `<strong>${escapeHtml(activity.name)}</strong>`,
    `<span class="date">${escapeHtml(activity.type)} · ${escapeHtml(activity.date)}</span>`,
  ];

  if (activity.distanceKm) rows.push(`Distance: ${escapeHtml(activity.distanceKm)} km`);
  rows.push(`Duration: ${escapeHtml(activity.durationFormatted)}`);
  if (activity.pace) rows.push(`Pace: ${escapeHtml(activity.pace)}`);
  if (!hideSpeed && activity.speedKmh) rows.push(`Speed: ${escapeHtml(activity.speedKmh)} km/h`);
  if (activity.avgHR) rows.push(`HR: ${escapeHtml(activity.avgHR)} avg${activity.maxHR ? ` / ${escapeHtml(activity.maxHR)} max` : ''} bpm`);
  if (!hideElevation && activity.elevationM) rows.push(`Elevation: +${escapeHtml(activity.elevationM)} m`);

  return rows.join('<br>');
}

function renderData() {
  if (!currentSummary) return;
  const { fetchedAt, latestActivity, latestRun, latestRide, last7days } = currentSummary;

  const updatedEl = document.getElementById('last-updated');
  const formattedFetchedAt = formatTimestamp(fetchedAt);
  updatedEl.textContent = fetchedAt
    ? `Last updated: ${formattedFetchedAt || fetchedAt}`
    : 'No data yet — run npm run strava:fetch';

  document.getElementById('latest-content').innerHTML = activityHtml(latestActivity);
  document.getElementById('run-content').innerHTML = activityHtml(latestRun);
  document.getElementById('ride-content').innerHTML = activityHtml(latestRide, {
    hideSpeed: true,
    hideElevation: true,
  });

  const totalHours = Math.floor(last7days.totalTimeMin / 60);
  const totalMinutes = last7days.totalTimeMin % 60;
  const timeStr = totalHours > 0 ? `${totalHours}h ${totalMinutes}m` : `${totalMinutes}m`;

  document.getElementById('week-summary').innerHTML =
    `<strong>Last 7 days:</strong> ${last7days.count} activities — ` +
    `${last7days.runCount} run${last7days.runCount !== 1 ? 's' : ''} (${last7days.totalRunKm} km), ` +
    `${last7days.rideCount} ride${last7days.rideCount !== 1 ? 's' : ''} (${last7days.totalRideKm} km) — ` +
    `Total time: ${timeStr}`;
}

/* ------------------------------------------------------------------ */
/* Editor state                                                       */
/* ------------------------------------------------------------------ */

async function loadEditorBootstrap(sourceActivityId = null) {
  const url = new URL('/api/editor/bootstrap', window.location.origin);
  if (sourceActivityId) url.searchParams.set('sourceActivityId', String(sourceActivityId));
  return fetchJson(url.pathname + url.search);
}

function sourceOptionLabel(option) {
  const parts = [
    option.sessionDate,
    option.title,
  ];

  if (typeof option.distanceKm === 'number') parts.push(`${option.distanceKm.toFixed(1)} km`);
  if (option.savedSignalTitle) {
    parts.push(`saved: ${option.savedSignalTitle}`);
  } else if (option.savedSessionId) {
    parts.push('saved');
  }

  return parts.join(' · ');
}

function renderSourceOptions() {
  const select = document.getElementById('source-activity');
  select.innerHTML = '';

  const runs = currentEditorBootstrap?.recentRuns ?? [];
  if (runs.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No recent runs available';
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  runs.forEach((optionData) => {
    const option = document.createElement('option');
    option.value = String(optionData.sourceActivityId);
    option.textContent = sourceOptionLabel(optionData);
    option.selected = optionData.sourceActivityId === currentEditorSession?.selectedSourceActivityId;
    select.appendChild(option);
  });

  select.disabled = false;
}

function renderSourceCard() {
  const card = document.getElementById('source-card');
  const source = currentEditorSession?.source;

  if (!source) {
    card.innerHTML = '<span class="empty">Select a run to start editing.</span>';
    return;
  }

  const metaParts = [
    source.sport,
    source.sessionDate,
  ];
  if (typeof source.distanceKm === 'number') metaParts.push(`${source.distanceKm.toFixed(1)} km`);

  const primaryStats = [`Moving ${source.movingTimeLabel}`];
  if (source.elapsedTimeLabel && source.elapsedTimeLabel !== '—') primaryStats.push(`Elapsed ${source.elapsedTimeLabel}`);
  if (source.paceLabel) primaryStats.push(`Pace ${source.paceLabel}`);

  const secondaryStats = [];
  if (source.hrLine) secondaryStats.push(`HR ${source.hrLine}`);
  if (source.elevationLabel) secondaryStats.push(source.elevationLabel);
  if (resolveSelectedWeatherLine() !== '—') secondaryStats.push(resolveSelectedWeatherLine());

  card.innerHTML = [
    `<div class="source-card-title">${escapeHtml(source.title)}</div>`,
    `<p class="source-card-line is-meta">${escapeHtml(metaParts.join(' · '))}</p>`,
    `<p class="source-card-line">${escapeHtml(primaryStats.join(' · '))}</p>`,
    secondaryStats.length > 0
      ? `<p class="source-card-line is-muted">${escapeHtml(secondaryStats.join(' · '))}</p>`
      : '',
  ].join('');
}

function renderEditorMeta() {
  const saveStatus = document.getElementById('session-save-status');

  if (!currentEditorSession) {
    saveStatus.textContent = 'No session selected';
    return;
  }

  if (currentEditorSession.savedSessionId) {
    const formatted = formatTimestamp(currentEditorSession.updatedAt);
    saveStatus.textContent = formatted
      ? `Saved session #${currentEditorSession.savedSessionId} · updated ${formatted}`
      : `Saved session #${currentEditorSession.savedSessionId}`;
  } else {
    saveStatus.textContent = 'This source run has not been saved yet';
  }
}

function fillEditorForm() {
  const session = currentEditorSession;
  if (!session) return;

  setValue('session-type', session.manual.sessionType);
  setValue('legs', session.manual.legs);
  setValue('sleep-score', session.manual.sleepScore ?? '');
  setValue('restedness', session.manual.restedness);
  setValue('notes', session.manual.extraNotes);

  setChecked('tcx-attached', session.files.tcxAttached);
  setValue('ai-json-file', '');
  syncAiImport(serializeAiInput(session.ai), {
    emptyMessage: 'Paste the JSON returned by ChatGPT or upload a `.json` file.',
    validMessage: hasAiContent(session.ai) ? 'Loaded saved AI JSON.' : 'No AI interpretation imported.',
  });
}

function renderEditorState() {
  renderSourceOptions();
  renderEditorMeta();
  renderSourceCard();
  if (currentEditorSession) {
    fillEditorForm();
    setButtonsDisabled(false);
  } else {
    syncAiImport('', {
      emptyMessage: 'Paste the JSON returned by ChatGPT or upload a `.json` file.',
    });
    setButtonsDisabled(true);
  }
  updateBrief();
}

async function reloadEditorState(sourceActivityId = null) {
  currentEditorBootstrap = await loadEditorBootstrap(sourceActivityId);
  currentEditorSession = currentEditorBootstrap.selectedSession;
  renderEditorState();
}

function collectEditorPayload() {
  if (!currentEditorSession) {
    throw new Error('No session selected.');
  }

  const aiState = syncAiImport(document.getElementById('ai-json-input').value, {
    emptyMessage: 'Paste the JSON returned by ChatGPT or upload a `.json` file.',
    validMessage: 'AI JSON loaded.',
  });

  if (!aiState.isValid) {
    throw new Error(`Invalid AI JSON: ${aiState.error}`);
  }

  return {
    sourceActivityId: currentEditorSession.selectedSourceActivityId,
    manual: {
      sessionType: val('session-type'),
      legs: val('legs'),
      sleepScore: toOptionalNumber(val('sleep-score')),
      restedness: val('restedness'),
      extraNotes: val('notes'),
    },
    files: {
      tcxFilename: isChecked('tcx-attached')
        ? (currentEditorSession.files.tcxFilename || defaultTcxFilename())
        : '',
      tcxAttached: isChecked('tcx-attached'),
      briefFilename: currentEditorSession.files.briefFilename || defaultBriefFilename(),
    },
    ai: aiState.parsedAi,
  };
}

async function saveCurrentSession(publish) {
  hideError();
  hideNotice();

  const actionLabel = publish ? 'save-and-publish' : 'save';
  const submittedAiRawText = document.getElementById('ai-json-input').value;
  const saveButton = document.getElementById(publish ? 'btn-save-publish' : 'btn-save');
  const originalText = saveButton.textContent;
  let buttonsLocked = false;

  try {
    const payload = collectEditorPayload();

    setButtonsDisabled(true);
    buttonsLocked = true;
    saveButton.textContent = publish ? 'Publishing…' : 'Saving…';

    if (publish) {
      showNotice('Publishing run.nico.ar… Exporting snapshots, building, deploying, and verifying production.');
    }

    console.info(`[Pacer UI] ${actionLabel} payload`, {
      sourceActivityId: payload.sourceActivityId,
      manual: payload.manual,
      files: payload.files,
      ai: summarizeAiForLog(payload.ai),
    });
    const response = await fetchJson(publish ? '/api/editor/save-and-publish' : '/api/editor/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.info(`[Pacer UI] ${actionLabel} completed`, {
      publishStatus: response.publishStatus ?? null,
      savedSessionId: response.bootstrap?.selectedSession?.savedSessionId ?? null,
      updatedAt: response.bootstrap?.selectedSession?.updatedAt ?? null,
    });

    currentEditorBootstrap = response.bootstrap;
    currentEditorSession = response.bootstrap.selectedSession;
    renderEditorState();

    if (publish && response.publishStatus) {
      if (response.publishStatus.ok) {
        const publicBase = response.publishStatus.publicUrl || 'https://run.nico.ar';
        const publicPath = response.publishStatus.expectedSessionPath || '/';
        const visibleAt = `${publicBase.replace(/\/$/, '')}${publicPath}`;
        const targetSuffix = response.publishStatus.deployTarget
          ? ` Target: ${response.publishStatus.deployTarget}.`
          : '';
        showNotice(`${response.publishStatus.message}.${targetSuffix} Visible at ${visibleAt}`);
      } else {
        console.error('[Pacer UI] Publish hook reported failure', response.publishStatus);
        hideNotice();
        syncAiImport(submittedAiRawText, {
          validMessage: 'AI JSON kept in editor after failed publish.',
          emptyMessage: 'Paste the JSON returned by ChatGPT or upload a `.json` file.',
        });
        const logSuffix = response.publishStatus.logFile
          ? ` Log: ${response.publishStatus.logFile}`
          : '';
        const tailSuffix = Array.isArray(response.publishStatus.outputTail) && response.publishStatus.outputTail.length > 0
          ? ` Last output: ${response.publishStatus.outputTail[response.publishStatus.outputTail.length - 1]}`
          : '';
        showError(`Session saved locally, but publish failed. AI JSON was kept in the editor. ${response.publishStatus.message}.${logSuffix}${tailSuffix}`);
      }
    } else if (publish && response.publishArtifacts?.generatedAt) {
      showNotice(`Session saved and snapshots refreshed at ${formatTimestamp(response.publishArtifacts.generatedAt)}.`);
    } else {
      showNotice('Session saved locally. No build or deploy ran. Use "Save and publish" to publish run.nico.ar.');
    }
  } catch (err) {
    console.error(`[Pacer UI] ${actionLabel} threw`, err);
    hideNotice();
    showError(err.message || 'Could not save session.');
  } finally {
    if (buttonsLocked) {
      setButtonsDisabled(false);
    }
    saveButton.textContent = originalText;
  }
}

async function importAiJsonFile(file) {
  if (!file) return;

  try {
    const text = await file.text();
    syncAiImport(text, {
      validMessage: 'AI JSON loaded.',
      emptyMessage: 'Paste the JSON returned by ChatGPT or upload a `.json` file.',
    });
    setValue('ai-json-file', '');
  } catch {
    syncAiImport(document.getElementById('ai-json-input').value);
    setAiImportStatus(`Could not read ${file.name}.`, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Brief generation                                                   */
/* ------------------------------------------------------------------ */

function selectedSessionText() {
  const session = currentEditorSession?.source;
  if (!session) return 'Selected session: none';

  const lines = [`Selected session: ${session.title} (${session.sport}) — ${session.sessionDate}`];
  if (typeof session.distanceKm === 'number') lines.push(`  Distance: ${session.distanceKm.toFixed(1)} km`);
  lines.push(`  Moving time: ${session.movingTimeLabel}`);
  if (session.elapsedTimeLabel && session.elapsedTimeLabel !== '—') lines.push(`  Elapsed time: ${session.elapsedTimeLabel}`);
  if (session.paceLabel) lines.push(`  Pace: ${session.paceLabel}`);
  if (session.hrLine) lines.push(`  HR: ${session.hrLine}`);
  if (session.elevationLabel) lines.push(`  Elevation: ${session.elevationLabel}`);
  const weatherLine = resolveSelectedWeatherLine();
  if (weatherLine && weatherLine !== '—') lines.push(`  Weather: ${weatherLine}`);
  if (session.city) lines.push(`  City: ${session.city}`);
  return lines.join('\n');
}

function lapText(lap) {
  const parts = [];
  if (typeof lap.distanceM === 'number') parts.push(`${(lap.distanceM / 1000).toFixed(2)} km`);
  if (typeof lap.durationS === 'number') parts.push(formatDuration(lap.durationS));
  if (typeof lap.paceSecPerKm === 'number') parts.push(`pace ${formatSecondsPerKm(lap.paceSecPerKm)}`);
  if (typeof lap.hrAvg === 'number') parts.push(`HR ${lap.hrAvg}`);
  return `Lap ${lap.lapIndex}: ${parts.join(' | ') || '—'}`;
}

function buildBriefText() {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`== TRAINING BRIEF — ${today} ==`, ''];

  lines.push('--- SELECTED SESSION ---');
  lines.push(selectedSessionText());

  lines.push('');
  lines.push('--- CURRENT TRAINING CONTEXT ---');
  if (currentSummary) {
    const { last7days, fetchedAt } = currentSummary;
    const totalHours = Math.floor(last7days.totalTimeMin / 60);
    const totalMinutes = last7days.totalTimeMin % 60;
    const timeStr = totalHours > 0 ? `${totalHours}h ${totalMinutes}m` : `${totalMinutes}m`;
    lines.push(`Activities: ${last7days.count} total | Runs: ${last7days.runCount} (${last7days.totalRunKm} km) | Rides: ${last7days.rideCount} (${last7days.totalRideKm} km)`);
    lines.push(`Total training time: ${timeStr}`);
    if (fetchedAt) lines.push(`Data as of: ${new Date(fetchedAt).toLocaleString()}`);
  } else {
    lines.push('(No activity data loaded)');
  }

  lines.push('');
  lines.push('--- HOW I FELT ---');
  lines.push(`Session type: ${val('session-type') || '—'}`);
  lines.push(`Legs: ${val('legs') || '—'}`);
  lines.push(`Sleep: score ${val('sleep-score') ? `${val('sleep-score')}/100` : '—'} | restedness ${val('restedness') || '—'}`);
  lines.push(`Extra notes: ${val('notes') || '—'}`);
  lines.push(`Files: ${isChecked('tcx-attached') ? 'TCX attached' : 'TCX not attached'}`);

  lines.push('');
  lines.push('--- LAPS ---');
  const laps = Array.isArray(currentEditorSession?.laps) ? currentEditorSession.laps : [];
  if (laps.length === 0) {
    lines.push('Laps: —');
  } else {
    laps.forEach((lap) => lines.push(lapText(lap)));
  }

  return lines.join('\n');
}

function updateBrief() {
  document.getElementById('brief-preview').value = buildBriefText();
}

/* ------------------------------------------------------------------ */
/* Clipboard helpers                                                  */
/* ------------------------------------------------------------------ */

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
      // Fall through to legacy copy path.
    }
  }

  return fallbackCopyText(text);
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                       */
/* ------------------------------------------------------------------ */

document.getElementById('btn-refresh').addEventListener('click', async () => {
  try {
    await refreshFromStrava();
  } catch {
    // Error feedback is already handled in refreshFromStrava.
  }
});

document.getElementById('source-activity').addEventListener('change', async (event) => {
  const sourceActivityId = Number(event.target.value);
  if (!Number.isFinite(sourceActivityId) || sourceActivityId <= 0) return;

  hideError();
  hideNotice();

  try {
    await reloadEditorState(sourceActivityId);
  } catch (err) {
    showError(err.message || 'Could not load that session.');
  }
});

document.getElementById('btn-save').addEventListener('click', async () => {
  await saveCurrentSession(false);
});

document.getElementById('btn-save-publish').addEventListener('click', async () => {
  await saveCurrentSession(true);
});

document.getElementById('ai-json-input').addEventListener('input', () => {
  syncAiImport(document.getElementById('ai-json-input').value, {
    validMessage: 'AI JSON loaded.',
    emptyMessage: 'Paste the JSON returned by ChatGPT or upload a `.json` file.',
  });
});

document.getElementById('ai-json-file').addEventListener('change', async (event) => {
  const [file] = event.target.files ?? [];
  await importAiJsonFile(file);
});

document.getElementById('btn-copy').addEventListener('click', async () => {
  const text = document.getElementById('brief-preview').value;
  const btn = document.getElementById('btn-copy');
  const copied = await copyText(text);

  if (!copied) {
    btn.textContent = 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy brief'; }, 2000);
    return;
  }

  btn.textContent = '✓ Copied!';
  setTimeout(() => { btn.textContent = 'Copy brief'; }, 2000);
});

document.getElementById('btn-download').addEventListener('click', () => {
  const text = document.getElementById('brief-preview').value;
  const today = new Date().toISOString().slice(0, 10);
  const blob = new Blob([text], { type: 'text/plain' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `pacer-brief-${today}.txt`;
  anchor.click();
});

FORM_INPUT_IDS.forEach((id) => {
  const element = document.getElementById(id);
  const eventName = element && element.type === 'checkbox' ? 'change' : 'input';
  element.addEventListener(eventName, updateBrief);
});

/* ------------------------------------------------------------------ */
/* Init                                                               */
/* ------------------------------------------------------------------ */

async function initApp() {
  setButtonsDisabled(true);
  hideError();
  hideNotice();
  setLastUpdatedMessage('Refreshing from Strava…');

  try {
    await refreshFromStrava({
      updateButton: false,
      showFetchError: false,
    });
  } catch (refreshErr) {
    try {
      setLastUpdatedMessage('Loading cached data…');
      await hydrateAppState();
      showError(`Could not refresh from Strava. Loaded cached data instead. ${refreshErr.message}`);
    } catch (fallbackErr) {
      showError(`Could not load Pacer state: ${fallbackErr.message}`);
      setLastUpdatedMessage('No data loaded');
    }
  }
}

initApp();
