export interface SessionManualInput {
  sessionType: string;
  legs: string;
  sleepScore: number | null;
  restedness: string;
  extraNotes: string;
}

export interface SessionFilesInput {
  tcxFilename: string;
  tcxAttached: boolean;
  briefFilename: string;
}

export interface SessionAIInput {
  signalTitle: string;
  signalParagraphs: string[];
  carryForward: string;
  nextRunTitle: string;
  nextRunSummary: string;
  nextRunDurationMin: number | null;
  nextRunDurationMax: number | null;
  nextRunPaceMinSecPerKm: number | null;
  nextRunPaceMaxSecPerKm: number | null;
  weekTitle: string;
  weekSummary: string;
}

export interface SessionAIMetadata {
  modelName: string | null;
  promptVersion: string | null;
  generatedAt: string | null;
}

export interface SessionLapRecord {
  id: number | null;
  lapIndex: number;
  distanceM: number | null;
  durationS: number | null;
  paceSecPerKm: number | null;
  hrAvg: number | null;
}

export interface SessionCoreRecord {
  id: number;
  sessionDate: string;
  title: string;
  sport: string;
  source: string;
  sourceActivityId: number;
  distanceM: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  paceSecPerKm: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  elevationM: number | null;
  weatherTempC: number | null;
  weatherCondition: string | null;
  weatherWindKmh: number | null;
  polyline: string | null;
  city: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface StoredSession {
  core: SessionCoreRecord;
  laps: SessionLapRecord[];
  manual: SessionManualInput;
  files: SessionFilesInput;
  ai: SessionAIInput & SessionAIMetadata;
}

export interface StoredSessionSummary {
  sessionId: number;
  sourceActivityId: number;
  sessionDate: string;
  title: string;
  sport: string;
  distanceM: number | null;
  updatedAt: string;
  publishedAt: string | null;
  signalTitle: string | null;
}

export interface RecentRunOption {
  sourceActivityId: number;
  sessionDate: string;
  title: string;
  distanceKm: number | null;
  movingTimeLabel: string;
  savedSessionId: number | null;
  savedSignalTitle: string | null;
}

export interface SessionSourceSummary {
  sourceActivityId: number;
  sessionDate: string;
  title: string;
  sport: string;
  source: string;
  distanceKm: number | null;
  movingTimeLabel: string;
  elapsedTimeLabel: string | null;
  paceLabel: string | null;
  hrLine: string | null;
  elevationLabel: string | null;
  weatherLine: string | null;
  city: string | null;
}

export interface EditorSession {
  selectedSourceActivityId: number;
  savedSessionId: number | null;
  source: SessionSourceSummary;
  manual: SessionManualInput;
  files: SessionFilesInput;
  ai: SessionAIInput;
  laps: SessionLapRecord[];
  updatedAt: string | null;
}

export interface EditorBootstrap {
  recentRuns: RecentRunOption[];
  selectedSession: EditorSession | null;
  latestPublishedAt: string | null;
}

export interface SaveSessionInput {
  sourceActivityId: number;
  manual: SessionManualInput;
  files: SessionFilesInput;
  ai: SessionAIInput;
}

export interface SaveSessionOptions {
  publish: boolean;
  aiMetadata?: Partial<SessionAIMetadata>;
}

export interface SessionExportLatest {
  sessionId: number;
  sourceActivityId: number;
  sessionDate: string;
  title: string;
  sport: string;
  distanceM: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  paceSecPerKm: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  elevationM: number | null;
  weatherTempC: number | null;
  weatherCondition: string | null;
  weatherWindKmh: number | null;
  city: string | null;
  startLat: number | null;
  startLon: number | null;
  routeSvgPoints: string | null;
  manual: SessionManualInput;
  files: SessionFilesInput;
  ai: SessionAIInput;
  laps: SessionLapRecord[];
  updatedAt: string;
}

export interface SessionExportNextRun {
  fromSessionId: number;
  sessionDate: string;
  title: string;
  summary: string;
  durationMin: number | null;
  durationMax: number | null;
  paceMinSecPerKm: number | null;
  paceMaxSecPerKm: number | null;
  updatedAt: string;
}

export interface WeeklyBar {
  date: string;
  label: string;
  distanceKm: number;
}

export interface WeeklySnapshotRecord {
  id: number;
  snapshotDate: string;
  windowStart: string;
  windowEnd: string;
  totalKm: number;
  totalRuns: number;
  totalTimeS: number;
  title: string | null;
  summary: string | null;
  bars: WeeklyBar[];
}

export interface SessionExportArchiveItem {
  sessionId: number;
  sessionDate: string;
  title: string;
  sport: string;
  distanceM: number | null;
  movingTimeS: number | null;
  paceSecPerKm: number | null;
  signalTitle: string | null;
  nextRunTitle: string | null;
  updatedAt: string;
}

export interface SessionExportArchiveList {
  count: number;
  sessions: SessionExportArchiveItem[];
}

export interface PublishArtifacts {
  latestSession: SessionExportLatest | null;
  nextRun: SessionExportNextRun | null;
  weeklySummary: WeeklySnapshotRecord | null;
  archiveList: SessionExportArchiveList;
  generatedAt: string;
}
