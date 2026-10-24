/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

let currentSummary = null;
let currentWeather = '—';
let currentEditorBootstrap = null;
let currentEditorSession = null;
let currentAiImport = null;
let uiBusy = false;
let saveInFlight = false;
let workoutCheckSeq = 0;
// Progress of the last Coachat save, keyed by activity + pasted text so a retry
// repeats only the failed step and any edit starts a fresh run.
let coachatRun = null;
let editorLoadRequestId = 0;
let isEditorResolving = false;

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
  'Recovery Run',
  'Hills',
  'Strides',
  'Interval Session',
  'Tempo Session',
  'Time Trial',
  'Race',
]);

function normalizeSessionTypeAlias(value) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '';

  for (const type of SESSION_TYPES) {
    if (normalized.toLowerCase() === type.toLowerCase()) return type;
  }

  const label = normalized.toLowerCase();
  if (/\bintervals?\s*(run|session)?\b/.test(label) || /\bfartlek\s*run\b/.test(label) || /\bfartlek\b/.test(label)) {
    return 'Interval Session';
  }
  if (/\bthreshold\s*run\b/.test(label) || /\bthreshold\b/.test(label)) {
    return 'Tempo Session';
  }

  return normalized;
}

const FORM_INPUT_IDS = [
  'session-type',
  'legs',
  'sleep-score',
  'restedness',
  'notes',
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

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
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

function defaultBriefFilename() {
  if (!currentEditorSession) return '';
  const { selectedSourceActivityId, source } = currentEditorSession;
  return `pacer-${source.sessionDate}-${selectedSourceActivityId}-brief.txt`;
}

function blankAiInput() {
  return {
    sourceActivityId: currentEditorSession?.selectedSourceActivityId ?? null,
    sessionDate: currentEditorSession?.source?.sessionDate ?? '',
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
    sourceActivityId: ai.sourceActivityId,
    sessionDate: ai.sessionDate,
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

function normalizeAiActivityId(value) {
  const parsed = normalizeAiNumber(value, 'sourceActivityId');
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Field "sourceActivityId" must be a positive integer.');
  }
  return parsed;
}

function normalizeAiSessionDate(value) {
  const date = normalizeAiText(value, 'sessionDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Field "sessionDate" must use YYYY-MM-DD format.');
  }
  return date;
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

  const title = normalizeAiText(value.title, 'nextRunWorkout.title');
  const titleType = normalizeSessionTypeAlias(title);
  const inputType = normalizeSessionTypeAlias(normalizeAiText(value.type, 'nextRunWorkout.type'));
  const type = titleType && SESSION_TYPES.has(titleType) && (titleType !== title || !inputType)
    ? titleType
    : inputType;
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

const COACHAT_RESPONSE_VERSION = 'coachat-response-v1';

/**
 * Classifies pasted text. `coachat-response-v1` envelopes yield the session
 * analysis plus the raw future workout; bare session-ai-v1 objects stay
 * supported as session-only input. A bare future-workout-v1 is rejected so the
 * user never has to split a response by hand.
 */
function parseCoachatText(text) {
  if (!text.trim()) return { kind: 'empty', ai: blankAiInput(), futureWorkout: null };

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(formatJsonParseError(err, text));
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Coachat JSON must be an object.');
  }

  if (payload.contractVersion === COACHAT_RESPONSE_VERSION) {
    const { sessionAi, futureWorkout } = payload;
    if (!sessionAi || typeof sessionAi !== 'object' || Array.isArray(sessionAi)) throw new Error('"sessionAi" is missing or not an object.');
    if (!futureWorkout || typeof futureWorkout !== 'object' || Array.isArray(futureWorkout)) throw new Error('"futureWorkout" is missing or not an object.');
    if (readAiJsonField(sessionAi, 'sourceActivityId') === undefined || readAiJsonField(sessionAi, 'sessionDate') === undefined) {
      throw new Error('sessionAi must include sourceActivityId and sessionDate.');
    }
    const ai = buildAiFromPayload(sessionAi);
    window.PacerEditorState.assertAiIdentityMatchesSession(ai, currentEditorSession);
    return { kind: 'envelope', ai, futureWorkout };
  }
  if (payload.contractVersion === 'future-workout-v1') {
    throw new Error('This is only the workout. Paste the complete coachat-response-v1 reply, which also contains the session analysis.');
  }
  if (payload.contractVersion !== undefined) {
    throw new Error(`Unsupported contractVersion "${payload.contractVersion}". Expected ${COACHAT_RESPONSE_VERSION}.`);
  }
  return { kind: 'legacy', ai: buildAiFromPayload(payload), futureWorkout: null };
}

function buildAiFromPayload(payload) {

  // session-ai-v1 payloads predate explicit identity fields. Bind those legacy
  // imports to the currently selected activity; explicit fields remain checked
  // before save, so an import cannot silently target another session.
  const identity = window.PacerEditorState.resolveAiIdentityFields(
    readAiJsonField(payload, 'sourceActivityId'),
    readAiJsonField(payload, 'sessionDate'),
    currentEditorSession,
  );

  return {
    sourceActivityId: normalizeAiActivityId(identity.sourceActivityId),
    sessionDate: normalizeAiSessionDate(identity.sessionDate),
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
    preview.innerHTML = '<p class="empty">Nothing imported.</p>';
    return;
  }

  const row = (label, value) => (value ? `<p class="ai-preview-row"><strong>${label}:</strong> ${escapeHtml(value)}</p>` : '');
  preview.innerHTML = [
    row('Signal', ai.signalTitle),
    row('Next run', ai.nextRunTitle),
    row('Week', ai.weekTitle),
  ].filter(Boolean).join('');
}

function renderWorkoutPreview(check) {
  const el = document.getElementById('coachat-workout-preview');
  if (!check || check.state === 'none') {
    el.innerHTML = '<p class="empty">Nothing imported.</p>';
  } else if (check.state === 'checking') {
    el.innerHTML = '<p class="empty">Validating workout…</p>';
  } else if (check.state === 'invalid') {
    el.innerHTML = `<p class="empty">Workout not valid: ${escapeHtml(check.error)}</p>`;
  } else {
    el.innerHTML = window.PacerWorkoutFormat.renderWorkout(check.workout);
  }
}

/** Validates the whole envelope server-side (identity, workout contract). */
async function validateEnvelopeOnServer(envelopeText) {
  const response = await fetch('/api/coachat/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: envelopeText,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Validation failed (${response.status}).`);
  return body.futureWorkout;
}

async function runWorkoutCheck(rawText) {
  const seq = ++workoutCheckSeq;
  currentAiImport.workoutCheck = { state: 'checking', workout: null, error: '' };
  renderWorkoutPreview(currentAiImport.workoutCheck);
  setAiImportStatus('Validating Coachat response…');
  applyActionState();
  let check;
  try {
    check = { state: 'valid', workout: await validateEnvelopeOnServer(rawText), error: '' };
  } catch (err) {
    check = { state: 'invalid', workout: null, error: err.message || 'Workout could not be validated.' };
  }
  // A newer paste or edit supersedes this answer.
  if (seq !== workoutCheckSeq || currentAiImport?.rawText !== rawText) return check;
  currentAiImport.workoutCheck = check;
  renderWorkoutPreview(check);
  if (check.state === 'valid') setAiImportStatus('Coachat response is valid: session analysis and next workout.', 'valid');
  else setAiImportStatus(`Invalid Coachat response: ${check.error}`, 'error');
  applyActionState();
  return check;
}

function syncAiImport(rawText, options = {}) {
  const text = typeof rawText === 'string' ? rawText : '';
  const textarea = document.getElementById('ai-json-input');
  if (textarea && textarea.value !== text) {
    textarea.value = text;
  }
  workoutCheckSeq += 1;

  if (!text.trim()) {
    currentAiImport = {
      rawText: '', kind: 'empty', parsedAi: blankAiInput(), futureWorkout: null,
      workoutCheck: { state: 'none', workout: null, error: '' },
      isValid: true, hasContent: false, error: '',
    };
    renderAiPreview(currentAiImport.parsedAi);
    renderWorkoutPreview(currentAiImport.workoutCheck);
    setAiImportStatus(options.emptyMessage ?? 'Paste the JSON returned by Coachat.');
    applyActionState();
    return currentAiImport;
  }

  try {
    const parsed = parseCoachatText(text);
    currentAiImport = {
      rawText: text, kind: parsed.kind, parsedAi: parsed.ai, futureWorkout: parsed.futureWorkout,
      workoutCheck: { state: 'none', workout: null, error: '' },
      isValid: true, hasContent: hasAiContent(parsed.ai), error: '',
    };
    renderAiPreview(parsed.ai);
    renderWorkoutPreview(currentAiImport.workoutCheck);
    if (parsed.kind === 'envelope') {
      void runWorkoutCheck(text);
    } else {
      setAiImportStatus(
        options.validMessage ?? (currentAiImport.hasContent
          ? 'Session analysis only (no workout in this JSON).'
          : 'JSON parsed, but it does not contain session analysis fields.'),
        'valid',
      );
    }
    applyActionState();
    return currentAiImport;
  } catch (err) {
    currentAiImport = {
      rawText: text, kind: 'invalid', parsedAi: blankAiInput(), futureWorkout: null,
      workoutCheck: { state: 'none', workout: null, error: '' },
      isValid: false, hasContent: false, error: err.message || 'Invalid Coachat JSON.',
    };
    renderAiPreview(currentAiImport.parsedAi);
    renderWorkoutPreview(currentAiImport.workoutCheck);
    setAiImportStatus(`Invalid Coachat JSON: ${currentAiImport.error}`, 'error');
    applyActionState();
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
  uiBusy = disabled;
  applyActionState();
}

/** An envelope must be fully validated before either save button is usable. */
function isCoachatSaveable() {
  const ai = currentAiImport;
  if (!ai || ai.kind === 'empty') return true;
  if (ai.kind === 'envelope') return ai.workoutCheck.state === 'valid';
  return ai.kind === 'legacy';
}

function actionLabel(mode) {
  const ai = currentAiImport;
  if (coachatRun && ai && coachatRun.key === runKey(ai.rawText) && coachatRun.failed() && coachatRun.mode === mode) return 'Retry failed step';
  if (mode === 'draft') return 'Save draft';
  return ai?.kind === 'envelope' ? 'Publish & schedule' : 'Publish';
}

function applyActionState() {
  document.getElementById('btn-copy').disabled = uiBusy;
  document.getElementById('btn-download').disabled = uiBusy;
  const blocked = uiBusy || saveInFlight || !currentEditorSession || !isCoachatSaveable();
  document.getElementById('btn-save').disabled = blocked;
  document.getElementById('btn-save-publish').disabled = blocked;
  if (!saveInFlight) {
    document.getElementById('btn-save').textContent = actionLabel('draft');
    document.getElementById('btn-save-publish').textContent = actionLabel('publish');
  }
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

async function refreshTrainingData(options = {}) {
  const { updateButton = true, showFetchError = true } = options;
  const btn = document.getElementById('btn-refresh');
  const selectedSourceActivityId = currentEditorSession?.selectedSourceActivityId ?? null;
  const previousLatestSourceActivityId = currentSummary?.latestRun?.sourceActivityId ?? null;
  const previousLastUpdated = document.getElementById('last-updated').textContent;

  if (updateButton && btn) {
    btn.disabled = true;
    btn.textContent = '↺ Refreshing…';
  }

  hideError();
  setLastUpdatedMessage('Refreshing training data…');

  try {
    await loadSummaryState(true);
    const sourceActivityId = window.PacerEditorState.selectSourceActivityAfterRefresh({
      selectedSourceActivityId,
      previousLatestSourceActivityId,
      currentLatestSourceActivityId: currentSummary?.latestRun?.sourceActivityId ?? null,
    });
    await reloadEditorState(sourceActivityId);
    renderSourceCard();
    updateBrief();
  } catch (err) {
    if (document.getElementById('last-updated').textContent === 'Refreshing training data…') {
      setLastUpdatedMessage(previousLastUpdated || 'No data loaded');
    }
    if (showFetchError) {
      showError(err.message || 'Refresh failed.');
    }
    throw err;
  } finally {
    if (updateButton && btn) {
      btn.disabled = false;
      btn.textContent = '↺ Refresh training & publish';
    }
  }
}

async function refreshAndPublish() {
  const btn = document.getElementById('btn-refresh');
  const selectedSourceActivityId = currentEditorSession?.selectedSourceActivityId ?? null;
  const previousLatestSourceActivityId = currentSummary?.latestRun?.sourceActivityId ?? null;
  const previousLastUpdated = document.getElementById('last-updated').textContent;

  if (btn) {
    btn.disabled = true;
    btn.textContent = '↺ Publishing…';
  }
  hideError();
  hideNotice();
  setLastUpdatedMessage('Refreshing training data and publishing…');

  try {
    const response = await fetchJson('/api/refresh-and-publish', { method: 'POST' });
    currentSummary = response.summary;
    renderData();
    currentWeather = await loadWeatherForLatestActivity(currentSummary);
    const sourceActivityId = window.PacerEditorState.selectSourceActivityAfterRefresh({
      selectedSourceActivityId,
      previousLatestSourceActivityId,
      currentLatestSourceActivityId: currentSummary?.latestRun?.sourceActivityId ?? null,
    });
    await reloadEditorState(sourceActivityId);
    renderSourceCard();
    updateBrief();

    const publishStatus = response.publishStatus;
    if (publishStatus?.ok) {
      const targetSuffix = publishStatus.deployTarget ? ` Target: ${publishStatus.deployTarget}.` : '';
      showNotice(`${publishStatus.message}.${targetSuffix}`);
    } else if (publishStatus) {
      const logSuffix = publishStatus.logFile ? ` Log: ${publishStatus.logFile}` : '';
      const tailSuffix = Array.isArray(publishStatus.outputTail) && publishStatus.outputTail.length > 0
        ? ` Last output: ${publishStatus.outputTail[publishStatus.outputTail.length - 1]}`
        : '';
      showError(`Refresh completed, but publish failed. ${publishStatus.message}.${logSuffix}${tailSuffix}`);
    } else {
      showNotice('Training data refreshed and snapshots exported.');
    }
  } catch (err) {
    if (document.getElementById('last-updated').textContent === 'Refreshing training data and publishing…') {
      setLastUpdatedMessage(previousLastUpdated || 'No data loaded');
    }
    showError(err.message || 'Refresh and publish failed.');
    throw err;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '↺ Refresh training & publish';
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
    : 'No data yet — run npm run training:fetch';

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
    parts.push(`${option.savedSessionMatchedBy === 'fingerprint' ? 'matched' : 'saved'}: ${option.savedSignalTitle}`);
  } else if (option.savedSessionId) {
    parts.push(option.savedSessionMatchedBy === 'fingerprint' ? 'matched saved session' : 'saved');
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
  const rawNameLine = source.rawActivityName && source.rawActivityName !== source.title
    ? `<p class="source-card-line is-muted">Raw: ${escapeHtml(source.rawActivityName)}</p>`
    : '';

  card.innerHTML = [
    `<div class="source-card-title">${escapeHtml(source.title)}</div>`,
    `<p class="source-card-line is-meta">${escapeHtml(metaParts.join(' · '))}</p>`,
    `<p class="source-card-line">${escapeHtml(primaryStats.join(' · '))}</p>`,
    secondaryStats.length > 0
      ? `<p class="source-card-line is-muted">${escapeHtml(secondaryStats.join(' · '))}</p>`
      : '',
    rawNameLine,
  ].join('');
}

function renderEditorMeta() {
  const saveStatus = document.getElementById('session-save-status');
  const saveTarget = document.getElementById('session-save-target');
  const olderWarning = document.getElementById('older-activity-warning');

  if (!currentEditorSession) {
    saveStatus.textContent = 'No session selected';
    saveTarget.textContent = 'Save target: no session selected';
    olderWarning.textContent = '';
    olderWarning.classList.add('hidden');
    return;
  }

  const { selectedSourceActivityId, source } = currentEditorSession;
  saveTarget.textContent = `Save target: ${source.sessionDate} · ${source.title} · activity ${selectedSourceActivityId}`;
  const latestSourceActivityId = currentSummary?.latestRun?.sourceActivityId ?? null;
  const isEditingOlder = latestSourceActivityId !== null && selectedSourceActivityId !== latestSourceActivityId;
  olderWarning.textContent = isEditingOlder ? `Editing an older run: ${source.sessionDate}` : '';
  olderWarning.classList.toggle('hidden', !isEditingOlder);

  if (currentEditorSession.savedSessionId) {
    const formatted = formatTimestamp(currentEditorSession.updatedAt);
    saveStatus.textContent = formatted
      ? `Saved session #${currentEditorSession.savedSessionId} · updated ${formatted}`
      : `Saved session #${currentEditorSession.savedSessionId}`;
  } else {
    saveStatus.textContent = 'This source run has not been saved yet';
  }
}

function fillEditorForm(options = {}) {
  const session = currentEditorSession;
  if (!session) return;

  setValue('session-type', session.manual.sessionType);
  setValue('legs', session.manual.legs);
  setValue('sleep-score', session.manual.sleepScore ?? '');
  setValue('restedness', session.manual.restedness);
  setValue('notes', session.manual.extraNotes);

  setValue('ai-json-file', '');
  // After a Coachat save the pasted envelope stays put so a failed step can be retried.
  if (options.keepCoachatText) return;
  syncAiImport(serializeAiInput(session.ai), {
    emptyMessage: 'Paste the JSON returned by Coachat.',
    validMessage: hasAiContent(session.ai) ? 'Loaded saved session analysis.' : 'Nothing imported.',
  });
}

function renderEditorState(options = {}) {
  renderSourceOptions();
  renderEditorMeta();
  renderSourceCard();
  if (currentEditorSession) {
    fillEditorForm(options);
    setButtonsDisabled(false);
  } else {
    syncAiImport('', {
      emptyMessage: 'Paste the JSON returned by Coachat.',
    });
    setButtonsDisabled(true);
  }
  updateBrief();
  // Lets the workout list tell completed workouts from upcoming ones.
  window.PacerWorkouts?.setRuns(currentEditorBootstrap?.recentRuns ?? []);
}

async function reloadEditorState(sourceActivityId = null) {
  const requestId = ++editorLoadRequestId;
  const previousBootstrap = currentEditorBootstrap;
  const previousLastUpdated = document.getElementById('last-updated').textContent;
  currentEditorSession = null;
  isEditorResolving = true;
  if (previousBootstrap) {
    currentEditorBootstrap = {
      ...previousBootstrap,
      selectedSession: null,
    };
  }
  setButtonsDisabled(true);
  setLastUpdatedMessage('Resolving activity detail and streams…');
  updateBrief();

  try {
    const nextBootstrap = await loadEditorBootstrap(sourceActivityId);
    if (requestId !== editorLoadRequestId) {
      return;
    }

    currentEditorBootstrap = nextBootstrap;
    currentEditorSession = currentEditorBootstrap.selectedSession;
  } finally {
    if (requestId === editorLoadRequestId) {
      isEditorResolving = false;
      if (document.getElementById('last-updated').textContent === 'Resolving activity detail and streams…') {
        setLastUpdatedMessage(previousLastUpdated || '');
      }
    }
  }

  renderEditorState();
}

function collectEditorPayload() {
  if (!currentEditorSession) {
    throw new Error('No session selected.');
  }

  // saveCurrentSession() has just synced the pasted text; do not re-parse (and re-validate) here.
  const aiState = currentAiImport;

  if (!aiState.isValid) {
    throw new Error(`Invalid Coachat JSON: ${aiState.error}`);
  }

  if (hasAiContent(aiState.parsedAi)) {
    window.PacerEditorState.assertAiIdentityMatchesSession(aiState.parsedAi, currentEditorSession);
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
      // Not user-editable any more; carry saved values through unchanged.
      tcxFilename: currentEditorSession.files.tcxFilename || '',
      tcxAttached: Boolean(currentEditorSession.files.tcxAttached),
      briefFilename: currentEditorSession.files.briefFilename || defaultBriefFilename(),
    },
    ai: aiState.parsedAi,
  };
}

function runKey(rawText) {
  return `${currentEditorSession?.selectedSourceActivityId ?? ''}\n${rawText}`;
}

const PIPELINE_STEPS = ['session', 'workout', 'approve', 'sync', 'publish'];

function newCoachatRun(rawText, mode) {
  return {
    key: runKey(rawText), mode, planned: [], current: '',
    state: { session: 'idle', workout: 'idle', approve: 'idle', sync: 'idle', publish: 'idle' },
    error: { session: '', workout: '', approve: '', sync: '', publish: '' },
    operation: '', workoutId: '', eventId: '', publishInfo: null,
    failed() { return PIPELINE_STEPS.some((step) => this.state[step] === 'failed'); },
  };
}

const WORKOUT_OPERATION_TEXT = {
  created: 'Stored as a new workout.',
  revised: 'Stored as a new revision.',
  unchanged: 'Already stored, unchanged. No duplicate created.',
};

function renderCoachatResult(run) {
  const list = document.getElementById('coachat-result');
  if (!run) { list.classList.add('hidden'); list.innerHTML = ''; return; }
  const planned = (step) => run.planned.includes(step);
  const mark = (step) => (run.state[step] === 'ok' ? 'ok' : run.state[step] === 'failed' ? 'failed' : run.current === step ? 'pending' : 'skipped');
  const rows = [];
  const add = (label, cls, text) => rows.push(`<li class="is-${cls}"><strong>${label}</strong><span>${escapeHtml(text)}</span></li>`);

  if (planned('session')) {
    const st = mark('session');
    add('Session', st, st === 'ok' ? 'Saved locally.' : st === 'failed' ? `Not saved: ${run.error.session}` : st === 'pending' ? 'Saving…' : 'Not started.');
  }
  if (planned('workout')) {
    const st = mark('workout');
    add('Next workout', st, st === 'ok' ? (WORKOUT_OPERATION_TEXT[run.operation] || 'Stored.')
      : st === 'failed' ? `Not stored: ${run.error.workout}`
      : st === 'pending' ? 'Importing…'
      : run.state.session === 'failed' ? 'Not imported because the session was not saved.' : 'Not started.');
  }
  if (planned('approve') || planned('sync')) {
    let cls; let text;
    if (run.state.sync === 'ok') { cls = 'ok'; text = 'Approved and synced to Intervals.icu.'; }
    else if (run.state.sync === 'failed') { cls = 'failed'; text = `Approved, but not synced: ${run.error.sync} It is not on your calendar.`; }
    else if (run.state.approve === 'failed') { cls = 'failed'; text = `Not approved: ${run.error.approve}`; }
    else if (run.current === 'approve' || run.current === 'sync') { cls = 'pending'; text = run.current === 'approve' ? 'Approving…' : 'Syncing…'; }
    else { cls = 'skipped'; text = run.state.approve === 'ok' ? 'Approved. Sync not started.' : 'Not started.'; }
    add('Intervals.icu', cls, text);
  }
  if (planned('publish')) {
    const st = mark('publish');
    add('run.nico.ar', st, st === 'ok' ? 'Published.' : st === 'failed' ? `Not published: ${run.error.publish}` : st === 'pending' ? 'Publishing…' : 'Not started.');
  }
  list.innerHTML = rows.join('');
  list.classList.remove('hidden');
}

async function postJson(url, body) {
  return fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** Saves through the existing endpoint; publish=true also exports, builds and deploys. */
async function persistSession(run, payload, publish) {
  const response = await postJson(publish ? '/api/editor/save-and-publish' : '/api/editor/save', payload);
  currentEditorBootstrap = response.bootstrap;
  currentEditorSession = response.bootstrap.selectedSession;
  run.state.session = 'ok';
  return response;
}

function describePublishFailure(status) {
  const tail = Array.isArray(status.outputTail) && status.outputTail.length > 0 ? ` Last output: ${status.outputTail[status.outputTail.length - 1]}` : '';
  return `${status.message}.${status.logFile ? ` Log: ${status.logFile}.` : ''}${tail}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const WORKOUT_CONTENT_FIELDS = ['proposalKey', 'proposalRevision', 'sourceSession', 'schedule', 'workoutType', 'title', 'coachingNotes', 'blocks'];

/** The stored workout whose content (ignoring lifecycle) equals the pasted one, or null. */
async function findIdenticalStoredWorkout(pasted) {
  const { proposals } = await fetchJson('/api/workouts');
  const pick = (workout) => canonicalJson(WORKOUT_CONTENT_FIELDS.map((field) => workout[field]));
  const wanted = pick(pasted);
  return (proposals || []).map((record) => record.workout).find((workout) => workout && pick(workout) === wanted) || null;
}

const STEP_RUNNERS = {
  async session(run, ctx) { await persistSession(run, ctx.payload, false); },
  async workout(run, ctx) {
    try {
      const result = await postJson('/api/workouts/import', ctx.ai.futureWorkout);
      run.operation = result.operation;
      run.workoutId = result.proposal?.workout?.pacerWorkoutId || '';
    } catch (err) {
      // Once a workout is approved its stored lifecycle differs from the freshly pasted one, so the
      // server reports a same-revision "conflict" even for identical content. Accept that only when
      // the stored content is exactly what was pasted.
      if (!/conflicts with the stored revision/i.test(err.message || '')) throw err;
      const stored = await findIdenticalStoredWorkout(ctx.ai.futureWorkout);
      if (!stored) throw err;
      run.operation = 'unchanged';
      run.workoutId = stored.pacerWorkoutId;
    }
  },
  async approve(run) {
    const result = await postJson(`/api/workouts/${encodeURIComponent(run.workoutId)}/approve`, {});
    if (result.proposal?.workout?.lifecycle?.approvalStatus !== 'approved') throw new Error('The workout was not approved.');
  },
  async sync(run) {
    // The sync API answers 200 even when Intervals.icu rejected it; the lifecycle tells the truth.
    const result = await fetchJson(`/api/workouts/${encodeURIComponent(run.workoutId)}/sync`, { method: 'POST' });
    const lifecycle = result.proposal?.workout?.lifecycle || {};
    if (lifecycle.syncStatus !== 'synced') throw new Error(lifecycle.lastSyncError || 'Intervals.icu did not accept the workout.');
    run.eventId = lifecycle.intervalsEventId || '';
  },
  async publish(run, ctx) {
    const response = await persistSession(run, ctx.payload, true);
    run.publishInfo = response.publishStatus || null;
    if (response.publishStatus && !response.publishStatus.ok) throw new Error(describePublishFailure(response.publishStatus));
  },
};

function plannedSteps(mode, envelope) {
  if (mode === 'draft') return envelope ? ['session', 'workout'] : ['session'];
  return envelope ? PIPELINE_STEPS : ['publish'];
}

let publishConfirmOpen = false;
function confirmPublishSchedule(envelope) {
  const dialog = document.getElementById('publish-confirm-dialog');
  const detail = document.getElementById('publish-confirm-detail');
  const effects = document.getElementById('publish-confirm-effects');
  const cancel = document.getElementById('publish-confirm-cancel');
  const submit = document.getElementById('publish-confirm-submit');
  if (!dialog || publishConfirmOpen) return Promise.resolve(false);
  publishConfirmOpen = true;
  const previousFocus = document.activeElement;
  detail.textContent = envelope
    ? 'This will make the session public and schedule the reviewed next workout.'
    : 'This will make the session public on run.nico.ar.';
  effects.innerHTML = envelope
    ? '<li>Publish this session to run.nico.ar.</li><li>Approve and synchronize the next workout with Intervals.icu.</li>'
    : '<li>Publish this session to run.nico.ar.</li>';
  submit.textContent = envelope ? 'Publish & schedule' : 'Publish';
  return new Promise((resolve) => {
    let settled = false;
    const finish = (approved) => {
      if (settled) return; settled = true; publishConfirmOpen = false;
      dialog.removeEventListener('cancel', onCancel); cancel.removeEventListener('click', onCancel); submit.removeEventListener('click', onSubmit);
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      resolve(approved);
    };
    const onCancel = (event) => { event.preventDefault(); finish(false); };
    const onSubmit = () => finish(true);
    dialog.addEventListener('cancel', onCancel); cancel.addEventListener('click', onCancel); submit.addEventListener('click', onSubmit);
    dialog.showModal();
    cancel.focus();
  });
}

async function saveCurrentSession(mode) {
  if (saveInFlight) return;
  hideError();
  hideNotice();

  if (mode === 'publish' && !await confirmPublishSchedule(currentAiImport?.kind === 'envelope')) return;

  const rawText = document.getElementById('ai-json-input').value;
  saveInFlight = true;
  setButtonsDisabled(true);
  document.getElementById(mode === 'draft' ? 'btn-save' : 'btn-save-publish').textContent = 'Working…';
  let keepText = false;

  try {
    // 1. Validate everything before the first write.
    let ai = syncAiImport(rawText);
    if (ai.kind === 'envelope') {
      const check = await runWorkoutCheck(rawText);
      if (check.state !== 'valid') throw new Error(`Nothing was saved. ${check.error}`);
      ai = currentAiImport;
    }
    const payload = collectEditorPayload();
    const envelope = ai.kind === 'envelope';
    keepText = envelope;

    // 2. Resume a run with a failed step; a draft may be upgraded to publish without redoing its steps.
    // Anything else starts fresh (every write is idempotent, so a repeat is safe).
    const resume = coachatRun && coachatRun.key === runKey(rawText)
      && (coachatRun.failed() || (coachatRun.mode === 'draft' && mode === 'publish'));
    if (!resume) coachatRun = newCoachatRun(rawText, mode);
    const run = coachatRun;
    run.mode = mode;
    run.planned = plannedSteps(mode, envelope);
    for (const step of run.planned) if (run.state[step] === 'failed') { run.state[step] = 'idle'; run.error[step] = ''; }
    if (mode === 'publish') { run.state.publish = 'idle'; }
    renderCoachatResult(run);

    // 3. Run the steps in order and stop at the first failure. Completed steps are never rolled back,
    // and nothing after a failed step is attempted.
    const ctx = { payload, ai };
    for (const step of run.planned) {
      if (run.state[step] === 'ok' && step !== 'publish') continue;
      if (step === 'publish' && run.state.publish === 'ok') continue;
      run.current = step;
      renderCoachatResult(run);
      try {
        await STEP_RUNNERS[step](run, ctx);
        run.state[step] = 'ok';
      } catch (err) {
        console.error(`[Pacer UI] ${step} failed`, err);
        run.state[step] = 'failed';
        run.error[step] = err.message || 'Unknown error.';
        break;
      }
    }
    run.current = '';
    renderCoachatResult(run);
    if (envelope) await window.PacerWorkouts?.reload(run.workoutId || null);
    if (run.state.session === 'ok' || (!envelope && run.state.publish === 'ok')) renderEditorState({ keepCoachatText: keepText });

    // 4. Summarise honestly.
    const failedStep = run.planned.find((step) => run.state[step] === 'failed');
    if (failedStep) {
      const done = run.planned.filter((step) => run.state[step] === 'ok');
      const names = { session: 'session saved', workout: 'workout stored', approve: 'workout approved', sync: 'synced to Intervals.icu', publish: 'published' };
      const failedNames = { session: 'saving the session', workout: 'storing the workout', approve: 'approving the workout', sync: 'syncing to Intervals.icu', publish: 'publishing' };
      showError(`Stopped at ${failedNames[failedStep]}. ${done.length ? `Done: ${done.map((step) => names[step]).join(', ')}. ` : 'Nothing was saved. '}Your pasted JSON was kept. Use "Retry failed step".`);
      if (!envelope) syncAiImport(rawText);
    } else if (mode === 'publish') {
      const status = run.publishInfo;
      const visibleAt = status ? `${(status.publicUrl || 'https://run.nico.ar').replace(/\/$/, '')}${status.expectedSessionPath || '/'}` : '';
      showNotice(envelope
        ? `Published to run.nico.ar and scheduled in Intervals.icu.${visibleAt ? ` Visible at ${visibleAt}` : ''}`
        : `Published to run.nico.ar.${visibleAt ? ` Visible at ${visibleAt}` : ''}`);
    } else {
      showNotice(envelope
        ? 'Draft saved: session saved and workout stored. Nothing was published, approved or synced.'
        : 'Draft saved. Nothing was published.');
    }
  } catch (err) {
    console.error('[Pacer UI] save aborted before writes', err);
    hideNotice();
    showError(err.message || 'Could not save session.');
  } finally {
    saveInFlight = false;
    setButtonsDisabled(false);
  }
}

async function importAiJsonFile(file) {
  if (!file) return;

  try {
    const text = await file.text();
    syncAiImport(text, {
      emptyMessage: 'Paste the JSON returned by Coachat.',
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
  if (isEditorResolving) return 'Selected session: resolving activity detail and streams…';
  if (!session) return 'Selected session: none';

  const lines = [`Selected session: ${session.title} (${session.sport}) — ${session.sessionDate}`];
  lines.push(`  Source activity ID: ${currentEditorSession.selectedSourceActivityId}`);
  lines.push(`  Session date: ${session.sessionDate}`);
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

function detectedIntervalsText() {
  if (isEditorResolving) {
    return ['Detected intervals: resolving activity detail and streams…'];
  }

  if (Array.isArray(currentEditorSession?.garminDeviceLaps) && currentEditorSession.garminDeviceLaps.length > 0) {
    return window.PacerBriefSegments.summarizeDetectedIntervals(currentEditorSession?.intervalsSegments);
  }

  return window.PacerBriefSegments.formatDetectedIntervals(currentEditorSession?.intervalsSegments);
}

function garminDeviceLapsText() {
  if (isEditorResolving) {
    return ['Garmin device laps: resolving original FIT…'];
  }

  return window.PacerBriefSegments.formatGarminDeviceLaps(currentEditorSession?.garminDeviceLaps);
}

function wellnessText() {
  if (isEditorResolving) {
    return ['Wellness: resolving Intervals.icu daily context…'];
  }

  return window.PacerBriefSegments.formatWellness(currentEditorSession?.wellness);
}

function existingLapsHeading() {
  if (currentEditorSession?.lapSource === 'intervals') return '--- KM SPLITS ---';
  if (currentEditorSession?.lapSource === 'tcx') return '--- TCX FALLBACK LAPS ---';
  return '--- KM SPLITS ---';
}

function buildBriefText() {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`== TRAINING BRIEF — ${today} ==`, ''];

  lines.push('--- SELECTED SESSION ---');
  lines.push(selectedSessionText());
  if (currentEditorSession) {
    lines.push('');
    lines.push(...window.PacerEditorState.buildCoachatResponseBriefLines(currentEditorSession));
  }

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

  lines.push('');
  lines.push('--- WELLNESS & RECOVERY CONTEXT ---');
  lines.push(...wellnessText());

  lines.push('');
  lines.push('--- GARMIN DEVICE LAPS (ORIGINAL FIT) ---');
  lines.push(window.PacerBriefSegments.garminDeviceLapsDisclaimer);
  lines.push(...garminDeviceLapsText());

  lines.push('');
  lines.push('--- DETECTED WORKOUT INTERVALS (INTERVALS.ICU) ---');
  lines.push(window.PacerBriefSegments.detectedIntervalsDisclaimer);
  lines.push(...detectedIntervalsText());

  lines.push('');
  lines.push(existingLapsHeading());
  const laps = Array.isArray(currentEditorSession?.laps) ? currentEditorSession.laps : [];
  if (isEditorResolving) {
    lines.push('Laps: resolving activity detail and streams…');
  } else if (laps.length === 0) {
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

document.getElementById('source-activity').addEventListener('change', async (event) => {
  const sourceActivityId = Number(event.target.value);
  if (!Number.isFinite(sourceActivityId) || sourceActivityId <= 0) return;

  hideError();
  hideNotice();

  try {
    await reloadEditorState(sourceActivityId);
  } catch (err) {
    if (!currentEditorSession) {
      renderEditorState();
    }
    showError(err.message || 'Could not load that session.');
  }
});

document.getElementById('btn-save').addEventListener('click', async () => {
  await saveCurrentSession('draft');
});

document.getElementById('btn-save-publish').addEventListener('click', async () => {
  await saveCurrentSession('publish');
});

document.getElementById('ai-json-input').addEventListener('input', () => {
  const text = document.getElementById('ai-json-input').value;
  if (coachatRun && coachatRun.key !== runKey(text)) renderCoachatResult(null);
  syncAiImport(text);
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
  element.addEventListener('input', updateBrief);
});

/* ------------------------------------------------------------------ */
/* Init                                                               */
/* ------------------------------------------------------------------ */

async function initApp() {
  setButtonsDisabled(true);
  hideError();
  hideNotice();
  setLastUpdatedMessage('Refreshing training data…');

  try {
    await refreshTrainingData({
      updateButton: false,
      showFetchError: false,
    });
  } catch (refreshErr) {
    try {
      setLastUpdatedMessage('Loading cached data…');
      await hydrateAppState();
      showError(`Could not refresh training data. Loaded cached data instead. ${refreshErr.message}`);
    } catch (fallbackErr) {
      showError(`Could not load Pacer state: ${fallbackErr.message}`);
      setLastUpdatedMessage('No data loaded');
    }
  }
}

initApp();
