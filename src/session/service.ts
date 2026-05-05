import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import {
  ActivityBundle,
  SourceActivity,
  SourceStreamPayload,
  averageTemperature,
  fetchHistoricalWeather,
  findActivityById,
  getActivityLaps,
  getActivityTempFromBundle,
  getActivityType,
  isRunLike,
  paceSecPerKmFromSpeed,
  readActivityBundle,
  resolveSourceActivity,
  sortActivitiesDesc,
} from './source';
import {
  getLatestWeeklySnapshot,
  getStoredSessionBySourceActivityId,
  initSessionStore,
  listPublishedSessions,
  listStoredSessionSummaries,
  markSessionPublished,
  saveStoredSession,
  upsertWeeklySnapshot,
} from './storage';
import {
  ActivityContextExport,
  ActivityContextItem,
  EditorBootstrap,
  EditorSession,
  PublishArtifacts,
  PublishStatus,
  RecentRunOption,
  SaveSessionInput,
  SaveSessionOptions,
  SessionAIInput,
  SessionAIMetadata,
  SessionExportArchiveItem,
  SessionExportArchiveList,
  SessionExportLatest,
  SessionExportNextRun,
  SessionFilesInput,
  SessionLapRecord,
  SessionManualInput,
  SessionNextRunWorkout,
  SessionSourceSummary,
  StoredSession,
  WeeklyBar,
  WeeklySnapshotRecord,
} from './types';
import { buildRouteMetadata } from './route';
import { ensureDir } from '../utils/storage';
import { deployRunSite } from './deploy';
import { deriveActivityContext, isRideActivity, isTrainingActivity } from '../activity-context';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

function blankManual(): SessionManualInput {
  return {
    sessionType: '',
    legs: '',
    sleepScore: null,
    restedness: '',
    extraNotes: '',
  };
}

function blankFiles(): SessionFilesInput {
  return {
    tcxFilename: '',
    tcxAttached: false,
    briefFilename: '',
  };
}

function blankAI(): SessionAIInput {
  return {
    signalTitle: '',
    signalParagraphs: [],
    carryForward: '',
    nextRunTitle: '',
    nextRunSummary: '',
    nextRunDurationMin: null,
    nextRunDurationMax: null,
    nextRunPaceMinSecPerKm: null,
    nextRunPaceMaxSecPerKm: null,
    nextRunWorkout: null,
    weekTitle: '',
    weekSummary: '',
  };
}

function roundOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
}

function toActivityContextTraining(activity: SourceActivity | null | undefined): ActivityContextItem | null {
  if (!activity) {
    return null;
  }

  return {
    sourceActivityId: activity.id ?? null,
    title: activity.name,
    sport: getActivityType(activity),
    startDateLocal: activity.start_date_local || activity.start_date,
    metrics: [
      { label: 'duration', value: activity.moving_time ?? null },
      { label: 'avgHr', value: activity.average_heartrate ?? null },
      { label: 'calories', value: null },
    ],
  };
}

function toActivityContextRide(activity: SourceActivity | null | undefined): ActivityContextItem | null {
  if (!activity) {
    return null;
  }

  return {
    sourceActivityId: activity.id ?? null,
    title: activity.name,
    sport: getActivityType(activity),
    startDateLocal: activity.start_date_local || activity.start_date,
    metrics: [
      { label: 'distance', value: activity.distance ?? null },
      { label: 'movingTime', value: activity.moving_time ?? null },
      { label: 'avgHr', value: activity.average_heartrate ?? null },
    ],
  };
}

function buildActivityContextExport(bundle: ActivityBundle | null): ActivityContextExport {
  const { latestTraining, latestRide } = deriveActivityContext(bundle);

  return {
    generatedAt: new Date().toISOString(),
    latestTraining: toActivityContextTraining(latestTraining),
    latestRide: toActivityContextRide(latestRide),
  };
}

function formatPaceFromSeconds(secPerKm: number | null): string | null {
  if (!secPerKm || secPerKm <= 0) return null;
  const minutes = Math.floor(secPerKm / 60);
  const seconds = Math.round(secPerKm % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')} /km`;
}

function formatDistanceKm(distanceM: number | null): number | null {
  if (typeof distanceM !== 'number' || distanceM <= 0) return null;
  return roundOneDecimal(distanceM / 1000);
}

function formatHrLine(hrAvg: number | null, hrMax: number | null): string | null {
  if (hrAvg === null && hrMax === null) return null;
  if (hrAvg !== null && hrMax !== null) return `${hrAvg} avg / ${hrMax} max bpm`;
  if (hrAvg !== null) return `${hrAvg} avg bpm`;
  return `${hrMax} max bpm`;
}

function formatWeatherLine(tempC: number | null, condition: string | null, windKmh: number | null): string | null {
  const parts: string[] = [];
  if (typeof tempC === 'number') parts.push(`${Math.round(tempC)}C`);
  if (condition) parts.push(condition);
  if (typeof windKmh === 'number') parts.push(`wind ${Math.round(windKmh)} km/h`);
  return parts.length > 0 ? parts.join(' | ') : null;
}

function sanitizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeParagraphs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value !== 'string') return [];

  const normalized = value
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (normalized.length > 0) return normalized;

  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sanitizeNextRunWorkout(value: unknown): SessionNextRunWorkout | null {
  if (value === undefined || value === null || value === '') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('nextRunWorkout must be an object or null.');
  }

  const type = sanitizeText((value as { type?: unknown }).type);
  if (!SESSION_TYPES.has(type)) {
    throw new Error(`nextRunWorkout.type must be one of: ${Array.from(SESSION_TYPES).join(', ')}.`);
  }

  const rawBlocks = (value as { blocks?: unknown }).blocks;
  if (!Array.isArray(rawBlocks)) {
    throw new Error('nextRunWorkout.blocks must be an array of strings.');
  }

  const blocks = rawBlocks
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trimEnd())
    .filter((entry) => entry.trim());

  if (blocks.length === 0) {
    throw new Error('nextRunWorkout.blocks must include at least one block.');
  }

  return { type, blocks };
}

function buildRecentRunOptions(bundle: ActivityBundle): RecentRunOption[] {
  const savedSessions = new Map(
    listStoredSessionSummaries().map((session) => [session.sourceActivityId, session]),
  );

  return sortActivitiesDesc(bundle.activities)
    .filter(isRunLike)
    .filter((activity): activity is SourceActivity & { id: number } => typeof activity.id === 'number')
    .slice(0, 12)
    .map((activity) => {
      const saved = savedSessions.get(activity.id) ?? null;

      return {
        sourceActivityId: activity.id,
        sessionDate: (activity.start_date_local || activity.start_date).slice(0, 10),
        title: activity.name,
        distanceKm: formatDistanceKm(activity.distance),
        movingTimeLabel: formatDuration(activity.moving_time),
        savedSessionId: saved?.sessionId ?? null,
        savedSignalTitle: saved?.signalTitle ?? null,
      };
    });
}

function buildLaps(bundle: ActivityBundle, activityId: number, existing: StoredSession | null): SessionLapRecord[] {
  const liveLaps = getActivityLaps(bundle, activityId);
  if (liveLaps.length > 0) {
    return liveLaps.map((lap, index) => ({
      id: null,
      lapIndex: typeof lap.lap_index === 'number' ? lap.lap_index : index + 1,
      distanceM: typeof lap.distance === 'number' ? roundOneDecimal(lap.distance) : null,
      durationS: typeof lap.moving_time === 'number' ? Math.round(lap.moving_time) : null,
      paceSecPerKm: typeof lap.average_speed === 'number' ? paceSecPerKmFromSpeed(lap.average_speed) : null,
      hrAvg: typeof lap.average_heartrate === 'number' ? Math.round(lap.average_heartrate) : null,
    }));
  }

  return existing?.laps ?? [];
}

function buildSourceSummary(bundle: ActivityBundle, activity: SourceActivity, stored: StoredSession | null): SessionSourceSummary {
  const sessionDate = (activity.start_date_local || activity.start_date).slice(0, 10);
  const paceSecPerKm = paceSecPerKmFromSpeed(activity.average_speed);
  const weatherTemp = stored?.core.weatherTempC ?? getActivityTempFromBundle(bundle, activity.id ?? -1);
  const weatherLine = formatWeatherLine(
    weatherTemp,
    stored?.core.weatherCondition ?? null,
    stored?.core.weatherWindKmh ?? null,
  );

  return {
    sourceActivityId: activity.id ?? 0,
    sessionDate,
    title: activity.name,
    sport: getActivityType(activity),
    source: bundle.source,
    distanceKm: formatDistanceKm(activity.distance),
    movingTimeLabel: formatDuration(activity.moving_time),
    elapsedTimeLabel: formatDuration(activity.elapsed_time ?? null),
    paceLabel: formatPaceFromSeconds(paceSecPerKm),
    hrLine: formatHrLine(
      typeof activity.average_heartrate === 'number' ? Math.round(activity.average_heartrate) : null,
      typeof activity.max_heartrate === 'number' ? Math.round(activity.max_heartrate) : null,
    ),
    elevationLabel: activity.total_elevation_gain > 0 ? `+${Math.round(activity.total_elevation_gain)} m` : null,
    weatherLine,
    city: stored?.core.city ?? activity.location_city ?? null,
  };
}

function buildEditorSession(bundle: ActivityBundle, sourceActivityId: number): EditorSession {
  const activity = findActivityById(bundle, sourceActivityId);
  if (!activity || typeof activity.id !== 'number') {
    throw new Error(`Could not find source activity ${sourceActivityId}.`);
  }

  const stored = getStoredSessionBySourceActivityId(sourceActivityId);

  return {
    selectedSourceActivityId: sourceActivityId,
    savedSessionId: stored?.core.id ?? null,
    source: buildSourceSummary(bundle, activity, stored),
    manual: stored?.manual ?? blankManual(),
    files: stored?.files ?? blankFiles(),
    ai: stored
      ? {
        signalTitle: stored.ai.signalTitle,
        signalParagraphs: stored.ai.signalParagraphs,
        carryForward: stored.ai.carryForward,
        nextRunTitle: stored.ai.nextRunTitle,
        nextRunSummary: stored.ai.nextRunSummary,
        nextRunDurationMin: stored.ai.nextRunDurationMin,
        nextRunDurationMax: stored.ai.nextRunDurationMax,
        nextRunPaceMinSecPerKm: stored.ai.nextRunPaceMinSecPerKm,
        nextRunPaceMaxSecPerKm: stored.ai.nextRunPaceMaxSecPerKm,
        nextRunWorkout: stored.ai.nextRunWorkout,
        weekTitle: stored.ai.weekTitle,
        weekSummary: stored.ai.weekSummary,
      }
      : blankAI(),
    laps: buildLaps(bundle, sourceActivityId, stored),
    updatedAt: stored?.core.updatedAt ?? null,
  };
}

function selectDefaultSourceActivityId(bundle: ActivityBundle, requested: number | null): number | null {
  const options = buildRecentRunOptions(bundle);
  if (requested !== null && options.some((option) => option.sourceActivityId === requested)) {
    return requested;
  }
  return options[0]?.sourceActivityId ?? null;
}

function buildWeeklyBars(referenceDate: Date, sessions: StoredSession[]): WeeklyBar[] {
  const bars: WeeklyBar[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate() - offset,
    ));
    const date = day.toISOString().slice(0, 10);
    const distanceKm = roundOneDecimal(sessions
      .filter((session) => session.core.sessionDate === date && session.core.sport === 'Run')
      .reduce((sum, session) => sum + ((session.core.distanceM ?? 0) / 1000), 0));

    bars.push({
      date,
      label: DAY_LABELS[day.getUTCDay()],
      distanceKm,
    });
  }

  return bars;
}

function deriveWeekTitle(totalKm: number, totalRuns: number): string {
  if (totalKm >= 30 || totalRuns >= 4) return 'Building well';
  if (totalKm >= 18 || totalRuns >= 3) return 'Steady base';
  return 'Light but consistent';
}

function deriveWeekSummary(totalKm: number, totalRuns: number): string {
  return `${totalKm.toFixed(1)} km across ${totalRuns} run${totalRuns === 1 ? '' : 's'}. Enough structure to read the week clearly without overcomplicating it.`;
}

function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]?/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [];
}

function trimSentenceToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const preferredBreak = Math.max(
    text.lastIndexOf('. ', maxLength),
    text.lastIndexOf('; ', maxLength),
    text.lastIndexOf(' — ', maxLength),
    text.lastIndexOf(', ', maxLength)
  );

  const hardBreak = text.lastIndexOf(' ', maxLength);
  const cutIndex = preferredBreak > 40 ? preferredBreak + 1 : hardBreak;

  if (cutIndex <= 0) {
    return text.slice(0, maxLength).trimEnd();
  }

  return text.slice(0, cutIndex).trimEnd().replace(/[,:;—-]+$/, '').trimEnd();
}

function ensureTerminalPunctuation(text: string): string {
  if (!text) return text;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function compactWeekSummary(summary: string): string {
  const normalized = sanitizeText(summary);
  if (!normalized) return '';

  const candidate = splitIntoSentences(normalized).slice(0, 2).join(' ');
  return ensureTerminalPunctuation(trimSentenceToLength(candidate || normalized, 165));
}

function compactNextRunSummary(summary: string, workout: SessionNextRunWorkout | null): string {
  const normalized = sanitizeText(summary);
  if (!normalized) return '';

  let candidate = normalized;

  if (workout) {
    candidate = candidate.replace(/:\s*[^.!?]+(?=[.!?]|$)/, '.');
    candidate = candidate.replace(
      /\s+around\s+\d{1,2}:\d{2}\s*(?:to|-|–)\s*\d{1,2}:\d{2}\s+per\s+[a-z]+(?:metre|meter)?\s*[—-]?\s*/i,
      ' '
    );
  }

  const sentences = splitIntoSentences(candidate);
  const chosen = sentences.slice(0, 2).join(' ');

  return ensureTerminalPunctuation(trimSentenceToLength(chosen || candidate, 175));
}

function buildWeeklySnapshotFromSessions(sessions: StoredSession[]): WeeklySnapshotRecord | null {
  if (sessions.length === 0) return null;

  const latestSession = sessions[0];
  const latestDate = new Date(`${latestSession.core.sessionDate}T00:00:00Z`);
  const startDate = new Date(latestDate);
  startDate.setUTCDate(startDate.getUTCDate() - 6);

  const windowStart = startDate.toISOString().slice(0, 10);
  const windowEnd = latestDate.toISOString().slice(0, 10);

  const windowSessions = sessions.filter((session) => {
    return session.core.sessionDate >= windowStart && session.core.sessionDate <= windowEnd;
  });

  const runSessions = windowSessions.filter((session) => session.core.sport === 'Run');
  const totalKm = roundOneDecimal(runSessions.reduce((sum, session) => sum + ((session.core.distanceM ?? 0) / 1000), 0));
  const totalRuns = runSessions.length;
  const totalTimeS = Math.round(windowSessions.reduce((sum, session) => sum + (session.core.movingTimeS ?? 0), 0));
  const aiWeekTitle = latestSession.ai.weekTitle || runSessions.find((session) => session.ai.weekTitle)?.ai.weekTitle || '';
  const aiWeekSummary = latestSession.ai.weekSummary || runSessions.find((session) => session.ai.weekSummary)?.ai.weekSummary || '';

  return {
    id: 0,
    snapshotDate: latestSession.core.sessionDate,
    windowStart,
    windowEnd,
    totalKm,
    totalRuns,
    totalTimeS,
    title: aiWeekTitle || deriveWeekTitle(totalKm, totalRuns),
    summary: compactWeekSummary(aiWeekSummary || deriveWeekSummary(totalKm, totalRuns)),
    bars: buildWeeklyBars(latestDate, windowSessions),
  };
}

function buildLatestExport(session: StoredSession): SessionExportLatest {
  const route = buildRouteMetadata(session.core.polyline);

  return {
    sessionId: session.core.id,
    sourceActivityId: session.core.sourceActivityId,
    sessionDate: session.core.sessionDate,
    startDateLocal: session.core.startDateLocal,
    title: session.core.title,
    sport: session.core.sport,
    distanceM: session.core.distanceM,
    movingTimeS: session.core.movingTimeS,
    elapsedTimeS: session.core.elapsedTimeS,
    paceSecPerKm: session.core.paceSecPerKm,
    hrAvg: session.core.hrAvg,
    hrMax: session.core.hrMax,
    elevationM: session.core.elevationM,
    weatherTempC: session.core.weatherTempC,
    weatherCondition: session.core.weatherCondition,
    weatherWindKmh: session.core.weatherWindKmh,
    city: session.core.city,
    startLat: route.startLat,
    startLon: route.startLon,
    routeSvgPoints: route.routeSvgPoints,
    manual: session.manual,
    files: session.files,
    ai: {
      signalTitle: session.ai.signalTitle,
      signalParagraphs: session.ai.signalParagraphs,
      carryForward: session.ai.carryForward,
      nextRunTitle: session.ai.nextRunTitle,
      nextRunSummary: compactNextRunSummary(session.ai.nextRunSummary, session.ai.nextRunWorkout),
      nextRunDurationMin: session.ai.nextRunDurationMin,
      nextRunDurationMax: session.ai.nextRunDurationMax,
      nextRunPaceMinSecPerKm: session.ai.nextRunPaceMinSecPerKm,
      nextRunPaceMaxSecPerKm: session.ai.nextRunPaceMaxSecPerKm,
      nextRunWorkout: session.ai.nextRunWorkout,
      weekTitle: session.ai.weekTitle,
      weekSummary: compactWeekSummary(session.ai.weekSummary),
    },
    laps: session.laps,
    updatedAt: session.core.updatedAt,
  };
}

function buildNextRunExport(session: StoredSession): SessionExportNextRun | null {
  if (!session.ai.nextRunTitle && !session.ai.nextRunSummary) return null;

  return {
    fromSessionId: session.core.id,
    sessionDate: session.core.sessionDate,
    title: session.ai.nextRunTitle,
    summary: compactNextRunSummary(session.ai.nextRunSummary, session.ai.nextRunWorkout),
    durationMin: session.ai.nextRunDurationMin,
    durationMax: session.ai.nextRunDurationMax,
    paceMinSecPerKm: session.ai.nextRunPaceMinSecPerKm,
    paceMaxSecPerKm: session.ai.nextRunPaceMaxSecPerKm,
    ...(session.ai.nextRunWorkout ? { workout: session.ai.nextRunWorkout } : {}),
    updatedAt: session.core.updatedAt,
  };
}

function buildArchiveList(sessions: StoredSession[]): SessionExportArchiveList {
  const items: SessionExportArchiveItem[] = sessions.map((session) => ({
    sessionId: session.core.id,
    sessionDate: session.core.sessionDate,
    startDateLocal: session.core.startDateLocal,
    title: session.core.title,
    sport: session.core.sport,
    sessionType: session.manual.sessionType || null,
    distanceM: session.core.distanceM,
    movingTimeS: session.core.movingTimeS,
    paceSecPerKm: session.core.paceSecPerKm,
    signalTitle: session.ai.signalTitle || null,
    nextRunTitle: session.ai.nextRunTitle || null,
    updatedAt: session.core.updatedAt,
  }));

  return {
    count: items.length,
    sessions: items,
  };
}

function getLatestPublishedDate(): string | null {
  return listPublishedSessions()[0]?.core.sessionDate ?? null;
}

function writeJsonFile(fileName: string, payload: unknown): void {
  ensureDir(config.cmsExportDir);
  fs.writeFileSync(path.join(config.cmsExportDir, fileName), JSON.stringify(payload, null, 2));
}

function hasAiContent(ai: SessionAIInput): boolean {
  return Boolean(
    ai.signalTitle ||
    ai.signalParagraphs.length > 0 ||
    ai.carryForward ||
    ai.nextRunTitle ||
    ai.nextRunSummary ||
    ai.weekTitle ||
    ai.weekSummary,
  );
}

function sanitizeManualInput(input: SaveSessionInput['manual']): SessionManualInput {
  return {
    sessionType: sanitizeText(input?.sessionType),
    legs: sanitizeText(input?.legs),
    sleepScore: sanitizeOptionalNumber(input?.sleepScore),
    restedness: sanitizeText(input?.restedness),
    extraNotes: sanitizeText(input?.extraNotes),
  };
}

function sanitizeFilesInput(input: SaveSessionInput['files']): SessionFilesInput {
  return {
    tcxFilename: sanitizeText(input?.tcxFilename),
    tcxAttached: Boolean(input?.tcxAttached),
    briefFilename: sanitizeText(input?.briefFilename),
  };
}

function sanitizeAiInput(input: SaveSessionInput['ai']): SessionAIInput {
  const nextRunWorkout = sanitizeNextRunWorkout(input?.nextRunWorkout);

  return {
    signalTitle: sanitizeText(input?.signalTitle),
    signalParagraphs: sanitizeParagraphs(input?.signalParagraphs),
    carryForward: sanitizeText(input?.carryForward),
    nextRunTitle: sanitizeText(input?.nextRunTitle),
    nextRunSummary: compactNextRunSummary(sanitizeText(input?.nextRunSummary), nextRunWorkout),
    nextRunDurationMin: sanitizeOptionalNumber(input?.nextRunDurationMin),
    nextRunDurationMax: sanitizeOptionalNumber(input?.nextRunDurationMax),
    nextRunPaceMinSecPerKm: sanitizeOptionalNumber(input?.nextRunPaceMinSecPerKm),
    nextRunPaceMaxSecPerKm: sanitizeOptionalNumber(input?.nextRunPaceMaxSecPerKm),
    nextRunWorkout,
    weekTitle: sanitizeText(input?.weekTitle),
    weekSummary: compactWeekSummary(sanitizeText(input?.weekSummary)),
  };
}

async function resolveWeather(activity: SourceActivity, tempStream: number[] | null, existing: StoredSession | null) {
  const streamTemp = averageTemperature(tempStream);
  const historical = await fetchHistoricalWeather(activity);

  return {
    tempC: historical?.tempC ?? existing?.core.weatherTempC ?? streamTemp ?? null,
    condition: historical?.condition ?? existing?.core.weatherCondition ?? null,
    windKmh: historical?.windKmh ?? existing?.core.weatherWindKmh ?? null,
  };
}

function mapSourceLapsToRecords(laps: ReturnType<typeof getActivityLaps>): SessionLapRecord[] {
  return laps.map((lap, index) => ({
    id: null,
    lapIndex: typeof lap.lap_index === 'number' ? lap.lap_index : index + 1,
    distanceM: typeof lap.distance === 'number' ? roundOneDecimal(lap.distance) : null,
    durationS: typeof lap.moving_time === 'number' ? Math.round(lap.moving_time) : null,
    paceSecPerKm: typeof lap.average_speed === 'number' ? paceSecPerKmFromSpeed(lap.average_speed) : null,
    hrAvg: typeof lap.average_heartrate === 'number' ? Math.round(lap.average_heartrate) : null,
  }));
}

function readNumberStream(payload: SourceStreamPayload | null, key: string): number[] {
  const source = payload?.[key];

  if (Array.isArray(source)) {
    return source.filter((value): value is number => typeof value === 'number');
  }

  if (source && typeof source === 'object' && Array.isArray(source.data)) {
    return source.data.filter((value): value is number => typeof value === 'number');
  }

  return [];
}

function readBooleanStream(payload: SourceStreamPayload | null, key: string): boolean[] {
  const source = payload?.[key];

  if (Array.isArray(source)) {
    return source.filter((value): value is boolean => typeof value === 'boolean');
  }

  if (source && typeof source === 'object' && Array.isArray(source.data)) {
    return source.data.filter((value): value is boolean => typeof value === 'boolean');
  }

  return [];
}

function interpolateTimeAtDistance(distances: number[], times: number[], targetDistanceM: number): number | null {
  if (distances.length === 0 || times.length === 0) {
    return null;
  }

  if (targetDistanceM <= 0) {
    return 0;
  }

  if (targetDistanceM > distances[distances.length - 1]) {
    return null;
  }

  for (let index = 0; index < distances.length; index += 1) {
    const currentDistance = distances[index];
    const currentTime = times[index];

    if (currentDistance === targetDistanceM) {
      return currentTime;
    }

    if (currentDistance > targetDistanceM) {
      const previousDistance = index === 0 ? 0 : distances[index - 1];
      const previousTime = index === 0 ? 0 : times[index - 1];
      const distanceSpan = currentDistance - previousDistance;

      if (distanceSpan <= 0) {
        return currentTime;
      }

      const ratio = (targetDistanceM - previousDistance) / distanceSpan;
      return previousTime + ((currentTime - previousTime) * ratio);
    }
  }

  return times[times.length - 1] ?? null;
}

function averageHeartRateForRange(
  distances: number[],
  heartRates: number[],
  moving: boolean[],
  startDistanceM: number,
  endDistanceM: number
): number | null {
  const values: number[] = [];
  const sampleCount = Math.min(distances.length, heartRates.length);

  for (let index = 0; index < sampleCount; index += 1) {
    const distance = distances[index];

    if (distance <= startDistanceM || distance > endDistanceM) {
      continue;
    }

    if (moving.length > index && moving[index] === false) {
      continue;
    }

    values.push(heartRates[index]);
  }

  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildKilometerSplitsFromStreams(streamPayload: SourceStreamPayload | null): SessionLapRecord[] {
  const distances = readNumberStream(streamPayload, 'distance');
  const times = readNumberStream(streamPayload, 'time');
  const heartRates = readNumberStream(streamPayload, 'heartrate');
  const moving = readBooleanStream(streamPayload, 'moving');
  const sampleCount = Math.min(distances.length, times.length);

  if (sampleCount < 8) {
    return [];
  }

  const normalizedDistances = distances.slice(0, sampleCount);
  const normalizedTimes = times.slice(0, sampleCount);
  const totalDistanceM = normalizedDistances[sampleCount - 1];

  if (!Number.isFinite(totalDistanceM) || totalDistanceM < 800) {
    return [];
  }

  const boundaries = [0];
  for (let marker = 1000; marker < totalDistanceM; marker += 1000) {
    boundaries.push(marker);
  }
  boundaries.push(totalDistanceM);

  const laps: SessionLapRecord[] = [];

  for (let index = 1; index < boundaries.length; index += 1) {
    const startDistanceM = boundaries[index - 1];
    const endDistanceM = boundaries[index];
    const splitDistanceM = endDistanceM - startDistanceM;

    if (splitDistanceM < 100) {
      continue;
    }

    const startTime = interpolateTimeAtDistance(normalizedDistances, normalizedTimes, startDistanceM);
    const endTime = interpolateTimeAtDistance(normalizedDistances, normalizedTimes, endDistanceM);

    if (startTime === null || endTime === null || endTime <= startTime) {
      continue;
    }

    const durationS = Math.round(endTime - startTime);
    const paceSecPerKm = durationS > 0
      ? Math.round((durationS / splitDistanceM) * 1000)
      : null;

    laps.push({
      id: null,
      lapIndex: laps.length + 1,
      distanceM: roundOneDecimal(splitDistanceM),
      durationS,
      paceSecPerKm,
      hrAvg: averageHeartRateForRange(normalizedDistances, heartRates, moving, startDistanceM, endDistanceM),
    });
  }

  return laps;
}

function buildPersistedLaps(
  laps: ReturnType<typeof getActivityLaps>,
  streamPayload: SourceStreamPayload | null,
  existing: StoredSession | null
): SessionLapRecord[] {
  const kilometerSplits = buildKilometerSplitsFromStreams(streamPayload);

  if (kilometerSplits.length > 0) {
    return kilometerSplits;
  }

  if (laps.length > 0) {
    return mapSourceLapsToRecords(laps);
  }

  return existing?.laps ?? [];
}

export function getEditorBootstrap(sourceActivityId: number | null = null): EditorBootstrap {
  initSessionStore();
  const bundle = readActivityBundle();
  if (!bundle) {
    return {
      recentRuns: [],
      selectedSession: null,
      latestPublishedAt: getLatestPublishedDate() ?? getLatestWeeklySnapshot()?.snapshotDate ?? null,
    };
  }

  const selectedSourceActivityId = selectDefaultSourceActivityId(bundle, sourceActivityId);
  const recentRuns = buildRecentRunOptions(bundle);

  return {
    recentRuns,
    selectedSession: selectedSourceActivityId === null ? null : buildEditorSession(bundle, selectedSourceActivityId),
    latestPublishedAt: getLatestPublishedDate() ?? getLatestWeeklySnapshot()?.snapshotDate ?? null,
  };
}

export async function saveSession(input: SaveSessionInput, options: SaveSessionOptions): Promise<{
  session: StoredSession;
  bootstrap: EditorBootstrap;
  publishArtifacts: PublishArtifacts | null;
  publishStatus: PublishStatus | null;
}> {
  initSessionStore();
  const bundle = readActivityBundle();
  if (!bundle) {
    throw new Error('Could not find activities.latest.json. Refresh from Strava first.');
  }

  const sourceActivity = findActivityById(bundle, input.sourceActivityId);
  const resolvedSource = await resolveSourceActivity(bundle, input.sourceActivityId);
  const activity = resolvedSource.activity;
  const existing = getStoredSessionBySourceActivityId(input.sourceActivityId);
  const manual = sanitizeManualInput(input.manual);
  const files = sanitizeFilesInput(input.files);
  const ai = sanitizeAiInput(input.ai);
  const aiMetadata: SessionAIMetadata = {
    modelName: options.aiMetadata?.modelName ?? existing?.ai.modelName ?? null,
    promptVersion: options.aiMetadata?.promptVersion ?? existing?.ai.promptVersion ?? null,
    generatedAt: hasAiContent(ai)
      ? (options.aiMetadata?.generatedAt ?? new Date().toISOString())
      : null,
  };
  const weather = await resolveWeather(activity, resolvedSource.tempStream, existing);
  const sessionDate = (activity.start_date_local || activity.start_date).slice(0, 10);

  const savedSession = saveStoredSession({
    core: {
      sessionDate,
      startDateLocal: activity.start_date_local || activity.start_date || null,
      title: activity.name,
      sport: getActivityType(activity),
      source: bundle.source,
      sourceActivityId: input.sourceActivityId,
      distanceM: activity.distance > 0 ? roundOneDecimal(activity.distance) : null,
      movingTimeS: Math.round(activity.moving_time),
      elapsedTimeS: typeof activity.elapsed_time === 'number' ? Math.round(activity.elapsed_time) : null,
      paceSecPerKm: paceSecPerKmFromSpeed(activity.average_speed),
      hrAvg: typeof activity.average_heartrate === 'number' ? Math.round(activity.average_heartrate) : null,
      hrMax: typeof activity.max_heartrate === 'number' ? Math.round(activity.max_heartrate) : null,
      elevationM: activity.total_elevation_gain > 0 ? roundOneDecimal(activity.total_elevation_gain) : null,
      weatherTempC: weather.tempC,
      weatherCondition: weather.condition,
      weatherWindKmh: weather.windKmh,
      polyline: activity.map?.summary_polyline ?? existing?.core.polyline ?? null,
      city: existing?.core.city ?? activity.location_city ?? null,
    },
    manual,
    files,
    ai: {
      ...ai,
      ...aiMetadata,
    },
    laps: buildPersistedLaps(resolvedSource.laps, resolvedSource.streamPayload, existing),
  });

  console.info('[Pacer service] Session persisted', {
    sourceActivityId: input.sourceActivityId,
    sessionId: savedSession.core.id,
    publishRequested: options.publish,
    aiSignalTitle: ai.signalTitle,
    aiSignalParagraphCount: ai.signalParagraphs.length,
    aiWeekTitle: ai.weekTitle,
  });

  const session = options.publish
    ? markSessionPublished(savedSession.core.id)
    : savedSession;
  const publishArtifacts = options.publish ? publishSnapshots() : null;
  const publishStatus = options.publish ? await deployRunSite() : null;

  if (publishStatus) {
    if (publishStatus.ok) {
      console.info('[Pacer service] Publish hook succeeded', {
        sessionId: session.core.id,
        sourceActivityId: input.sourceActivityId,
        message: publishStatus.message,
        logFile: publishStatus.logFile,
        deployTarget: publishStatus.deployTarget,
        expectedSessionPath: publishStatus.expectedSessionPath,
        publicUrl: publishStatus.publicUrl,
      });
    } else {
      console.error('[Pacer service] Publish hook failed', {
        sessionId: session.core.id,
        sourceActivityId: input.sourceActivityId,
        message: publishStatus.message,
        exitCode: publishStatus.exitCode,
        signal: publishStatus.signal,
        timedOut: publishStatus.timedOut,
        locked: publishStatus.locked,
        logFile: publishStatus.logFile,
        deployTarget: publishStatus.deployTarget,
        verifyOk: publishStatus.verifyOk,
        originVerified: publishStatus.originVerified,
        publicVerified: publishStatus.publicVerified,
        originInconclusive: publishStatus.originInconclusive,
        expectedSessionPath: publishStatus.expectedSessionPath,
        publicUrl: publishStatus.publicUrl,
        outputTail: publishStatus.outputTail,
      });
    }
  }

  return {
    session,
    bootstrap: getEditorBootstrap(input.sourceActivityId),
    publishArtifacts,
    publishStatus,
  };
}

export function publishSnapshots(): PublishArtifacts {
  initSessionStore();
  const publishedSessions = listPublishedSessions();
  const activityBundle = readActivityBundle();
  const latestSession = publishedSessions[0] ?? null;
  const publishedSessionExports = publishedSessions.map((session) => buildLatestExport(session));
  const latestExport = latestSession ? buildLatestExport(latestSession) : null;
  const nextRunExport = latestSession ? buildNextRunExport(latestSession) : null;
  const snapshotDraft = buildWeeklySnapshotFromSessions(publishedSessions);
  const weeklySummary = snapshotDraft ? upsertWeeklySnapshot(snapshotDraft) : null;
  const archiveList = buildArchiveList(publishedSessions.slice(1));
  const activityContext = buildActivityContextExport(activityBundle);
  const generatedAt = new Date().toISOString();

  writeJsonFile('latest-session.json', latestExport);
  writeJsonFile('published-sessions.json', publishedSessionExports);
  writeJsonFile('next-run.json', nextRunExport);
  writeJsonFile('weekly-summary.json', weeklySummary);
  writeJsonFile('archive-list.json', archiveList);
  writeJsonFile('activity-context.json', activityContext);

  return {
    latestSession: latestExport,
    publishedSessions: publishedSessionExports,
    nextRun: nextRunExport,
    weeklySummary,
    archiveList,
    activityContext,
    generatedAt,
  };
}

const INITIAL_SEEDS: Array<{
  sourceActivityId: number;
  manual: SessionManualInput;
  files: SessionFilesInput;
  ai: SessionAIInput;
  metadata: SessionAIMetadata;
}> = [
  {
    sourceActivityId: 17694891984,
    manual: {
      sessionType: 'Tempo Session',
      legs: 'Normal',
      sleepScore: 82,
      restedness: '4 - Good',
      extraNotes: 'Controlled effort with a sharper final kilometer.',
    },
    files: {
      tcxFilename: '',
      tcxAttached: false,
      briefFilename: '2026-03-12-session-brief.txt',
    },
    ai: {
      signalTitle: 'Solid aerobic signal',
      signalParagraphs: [
        'The session stayed honest from the first kilometer and never drifted into panic pacing. That usually points to aerobic work landing in the right place.',
        'The closing part looked stronger than the opening part, which is exactly the kind of control worth protecting for the rest of the week.',
      ],
      carryForward: 'Keep the week calm and progressive.',
      nextRunTitle: 'Easy reset run',
      nextRunSummary: 'Keep the effort quiet, restore rhythm, and arrive fresh for the next quality day.',
      nextRunDurationMin: 40,
      nextRunDurationMax: 45,
      nextRunPaceMinSecPerKm: 400,
      nextRunPaceMaxSecPerKm: 425,
      nextRunWorkout: null,
      weekTitle: 'Steady base',
      weekSummary: 'Enough volume to move the week forward without turning it into a spreadsheet contest.',
    },
    metadata: {
      modelName: 'manual-seed',
      promptVersion: 'session-ai-v1',
      generatedAt: '2026-03-17T00:00:00.000Z',
    },
  },
  {
    sourceActivityId: 17751752060,
    manual: {
      sessionType: 'Easy Run',
      legs: 'Normal',
      sleepScore: 76,
      restedness: '3 - Normal',
      extraNotes: 'Felt mostly controlled, but heart rate ran a bit higher than a pure reset day.',
    },
    files: {
      tcxFilename: '',
      tcxAttached: false,
      briefFilename: '2026-03-17-session-brief.txt',
    },
    ai: {
      signalTitle: 'Not a pure easy run',
      signalParagraphs: [
        'The pace stayed manageable, but the internal cost drifted above what a fully easy day would usually ask for. That does not make it a bad run, but it changes how the next step should be framed.',
        'Treat it as useful aerobic work with a little extra load rather than as a free recovery slot.',
      ],
      carryForward: 'Let the next run absorb the effort instead of stacking more intensity on top of it.',
      nextRunTitle: 'Short recovery shuffle',
      nextRunSummary: 'Run by feel, keep the stride light, and let the heart rate settle lower than today.',
      nextRunDurationMin: 30,
      nextRunDurationMax: 40,
      nextRunPaceMinSecPerKm: 410,
      nextRunPaceMaxSecPerKm: 440,
      nextRunWorkout: null,
      weekTitle: 'Aerobic control first',
      weekSummary: 'The week is moving forward, but the easiest days still need to look easy enough to protect the bigger sessions.',
    },
    metadata: {
      modelName: 'manual-seed',
      promptVersion: 'session-ai-v1',
      generatedAt: '2026-03-17T00:00:00.000Z',
    },
  },
];

export async function seedInitialSessions(): Promise<{ inserted: number; skipped: number; publishArtifacts: PublishArtifacts }> {
  initSessionStore();

  let inserted = 0;
  let skipped = 0;

  for (const seed of INITIAL_SEEDS) {
    if (getStoredSessionBySourceActivityId(seed.sourceActivityId)) {
      skipped += 1;
      continue;
    }

    const result = await saveSession({
      sourceActivityId: seed.sourceActivityId,
      manual: seed.manual,
      files: seed.files,
      ai: seed.ai,
    }, {
      publish: false,
      aiMetadata: seed.metadata,
    });

    markSessionPublished(result.session.core.id, seed.metadata.generatedAt ?? undefined);

    inserted += 1;
  }

  return {
    inserted,
    skipped,
    publishArtifacts: publishSnapshots(),
  };
}
