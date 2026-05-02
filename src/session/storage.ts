import * as fs from 'fs';
import Database from 'better-sqlite3';
import * as path from 'path';
import { config } from '../config';
import { ensureDir } from '../utils/storage';
import { readActivityBundle } from './source';
import {
  SessionAIMetadata,
  SessionCoreRecord,
  SessionFilesInput,
  SessionLapRecord,
  SessionManualInput,
  StoredSession,
  StoredSessionSummary,
  WeeklyBar,
  WeeklySnapshotRecord,
} from './types';

interface PersistedSessionInput {
  core: Omit<SessionCoreRecord, 'id' | 'createdAt' | 'updatedAt' | 'publishedAt'>;
  manual: SessionManualInput;
  files: SessionFilesInput;
  ai: SessionAIMetadata & {
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
  };
  laps: SessionLapRecord[];
}

type SqliteDatabase = Database.Database;

let database: SqliteDatabase | null = null;

function columnExists(db: SqliteDatabase, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === columnName);
}

function readLegacyExport(fileName: string): unknown | null {
  const filePath = path.join(config.cmsExportDir, fileName);
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function backfillLegacyPublishedSessions(db: SqliteDatabase): void {
  const publishedSessionIds = new Set<number>();
  const latestSnapshot = readLegacyExport('latest-session.json') as { sessionId?: unknown } | null;
  const archiveSnapshot = readLegacyExport('archive-list.json') as {
    sessions?: Array<{ sessionId?: unknown }>;
  } | null;

  if (latestSnapshot && typeof latestSnapshot.sessionId === 'number') {
    publishedSessionIds.add(latestSnapshot.sessionId);
  }

  if (archiveSnapshot && Array.isArray(archiveSnapshot.sessions)) {
    for (const session of archiveSnapshot.sessions) {
      if (typeof session?.sessionId === 'number') {
        publishedSessionIds.add(session.sessionId);
      }
    }
  }

  if (publishedSessionIds.size === 0) return;

  const statement = db.prepare(`
    UPDATE sessions
    SET published_at = COALESCE(published_at, updated_at)
    WHERE id = ?
  `);

  for (const sessionId of publishedSessionIds) {
    statement.run(sessionId);
  }
}

function backfillLegacyStartDates(db: SqliteDatabase): void {
  const bundle = readActivityBundle();
  if (!bundle) return;

  const statement = db.prepare(`
    UPDATE sessions
    SET start_date_local = ?
    WHERE source_activity_id = ?
      AND start_date_local IS NULL
  `);

  for (const activity of bundle.activities) {
    if (typeof activity.id !== 'number') continue;
    if (typeof activity.start_date_local !== 'string' || !activity.start_date_local.trim()) continue;
    statement.run(activity.start_date_local, activity.id);
  }
}

function getDatabase(): SqliteDatabase {
  if (database) return database;

  ensureDir(path.dirname(config.databaseFile));
  database = new Database(config.databaseFile);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  migrate(database);
  backfillLegacyStartDates(database);

  return database;
}

function migrate(db: SqliteDatabase): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  if (currentVersion < 1) {
    const migrationV1 = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_date TEXT NOT NULL,
          start_date_local TEXT,
          title TEXT NOT NULL,
          sport TEXT NOT NULL,
          source TEXT NOT NULL,
          source_activity_id INTEGER NOT NULL UNIQUE,
          distance_m REAL,
          moving_time_s INTEGER,
          elapsed_time_s INTEGER,
          pace_sec_per_km REAL,
          hr_avg INTEGER,
          hr_max INTEGER,
          elevation_m REAL,
          weather_temp_c REAL,
          weather_condition TEXT,
          weather_wind_kmh REAL,
          polyline TEXT,
          city TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS session_laps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          lap_index INTEGER NOT NULL,
          distance_m REAL,
          duration_s INTEGER,
          pace_sec_per_km REAL,
          hr_avg INTEGER,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS session_manual (
          session_id INTEGER PRIMARY KEY,
          session_type TEXT,
          legs TEXT,
          sleep_score INTEGER,
          restedness TEXT,
          extra_notes TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS session_files (
          session_id INTEGER PRIMARY KEY,
          tcx_filename TEXT,
          tcx_attached INTEGER NOT NULL DEFAULT 0,
          brief_filename TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS session_ai (
          session_id INTEGER PRIMARY KEY,
          signal_title TEXT,
          signal_paragraphs_json TEXT,
          carry_forward TEXT,
          next_run_title TEXT,
          next_run_summary TEXT,
          next_run_duration_min INTEGER,
          next_run_duration_max INTEGER,
          next_run_pace_min_sec_per_km INTEGER,
          next_run_pace_max_sec_per_km INTEGER,
          week_title TEXT,
          week_summary TEXT,
          model_name TEXT,
          prompt_version TEXT,
          generated_at TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS weekly_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          snapshot_date TEXT NOT NULL UNIQUE,
          window_start TEXT NOT NULL,
          window_end TEXT NOT NULL,
          total_km REAL NOT NULL,
          total_runs INTEGER NOT NULL,
          total_time_s INTEGER NOT NULL,
          title TEXT,
          summary TEXT,
          bars_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_session_date ON sessions(session_date DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_session_laps_session_id ON session_laps(session_id, lap_index);
      `);

      db.pragma('user_version = 1');
    });

    migrationV1();
  }

  if (currentVersion < 2) {
    const migrationV2 = db.transaction(() => {
      if (!columnExists(db, 'sessions', 'published_at')) {
        db.exec(`
          ALTER TABLE sessions ADD COLUMN published_at TEXT;
          CREATE INDEX IF NOT EXISTS idx_sessions_published_at ON sessions(published_at DESC, session_date DESC, id DESC);
        `);
      }

      backfillLegacyPublishedSessions(db);
      db.pragma('user_version = 2');
    });

    migrationV2();
  }

  if (currentVersion < 3) {
    const migrationV3 = db.transaction(() => {
      if (!columnExists(db, 'sessions', 'start_date_local')) {
        db.exec(`
          ALTER TABLE sessions ADD COLUMN start_date_local TEXT;
        `);
      }

      backfillLegacyStartDates(db);
      db.pragma('user_version = 3');
    });

    migrationV3();
  }
}

function toNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  } catch {
    return [];
  }
}

function mapCoreRow(row: Record<string, unknown>): SessionCoreRecord {
  return {
    id: Number(row.id),
    sessionDate: String(row.session_date),
    startDateLocal: typeof row.start_date_local === 'string' ? row.start_date_local : null,
    title: String(row.title),
    sport: String(row.sport),
    source: String(row.source),
    sourceActivityId: Number(row.source_activity_id),
    distanceM: typeof row.distance_m === 'number' ? row.distance_m : null,
    movingTimeS: typeof row.moving_time_s === 'number' ? row.moving_time_s : null,
    elapsedTimeS: typeof row.elapsed_time_s === 'number' ? row.elapsed_time_s : null,
    paceSecPerKm: typeof row.pace_sec_per_km === 'number' ? row.pace_sec_per_km : null,
    hrAvg: typeof row.hr_avg === 'number' ? row.hr_avg : null,
    hrMax: typeof row.hr_max === 'number' ? row.hr_max : null,
    elevationM: typeof row.elevation_m === 'number' ? row.elevation_m : null,
    weatherTempC: typeof row.weather_temp_c === 'number' ? row.weather_temp_c : null,
    weatherCondition: toNullableText(row.weather_condition),
    weatherWindKmh: typeof row.weather_wind_kmh === 'number' ? row.weather_wind_kmh : null,
    polyline: toNullableText(row.polyline),
    city: toNullableText(row.city),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
  };
}

function mapSession(db: SqliteDatabase, coreRow: Record<string, unknown>): StoredSession {
  const core = mapCoreRow(coreRow);

  const laps = db.prepare(`
    SELECT id, lap_index, distance_m, duration_s, pace_sec_per_km, hr_avg
    FROM session_laps
    WHERE session_id = ?
    ORDER BY lap_index ASC
  `).all(core.id) as Record<string, unknown>[];

  const manualRow = db.prepare(`
    SELECT session_type, legs, sleep_score, restedness, extra_notes
    FROM session_manual
    WHERE session_id = ?
  `).get(core.id) as Record<string, unknown> | undefined;

  const filesRow = db.prepare(`
    SELECT tcx_filename, tcx_attached, brief_filename
    FROM session_files
    WHERE session_id = ?
  `).get(core.id) as Record<string, unknown> | undefined;

  const aiRow = db.prepare(`
    SELECT signal_title, signal_paragraphs_json, carry_forward, next_run_title, next_run_summary,
           next_run_duration_min, next_run_duration_max, next_run_pace_min_sec_per_km,
           next_run_pace_max_sec_per_km, week_title, week_summary, model_name,
           prompt_version, generated_at
    FROM session_ai
    WHERE session_id = ?
  `).get(core.id) as Record<string, unknown> | undefined;

  return {
    core,
    laps: laps.map((row) => ({
      id: typeof row.id === 'number' ? row.id : null,
      lapIndex: Number(row.lap_index),
      distanceM: typeof row.distance_m === 'number' ? row.distance_m : null,
      durationS: typeof row.duration_s === 'number' ? row.duration_s : null,
      paceSecPerKm: typeof row.pace_sec_per_km === 'number' ? row.pace_sec_per_km : null,
      hrAvg: typeof row.hr_avg === 'number' ? row.hr_avg : null,
    })),
    manual: {
      sessionType: manualRow && typeof manualRow.session_type === 'string' ? manualRow.session_type : '',
      legs: manualRow && typeof manualRow.legs === 'string' ? manualRow.legs : '',
      sleepScore: manualRow && typeof manualRow.sleep_score === 'number' ? manualRow.sleep_score : null,
      restedness: manualRow && typeof manualRow.restedness === 'string' ? manualRow.restedness : '',
      extraNotes: manualRow && typeof manualRow.extra_notes === 'string' ? manualRow.extra_notes : '',
    },
    files: {
      tcxFilename: filesRow && typeof filesRow.tcx_filename === 'string' ? filesRow.tcx_filename : '',
      tcxAttached: Boolean(filesRow?.tcx_attached),
      briefFilename: filesRow && typeof filesRow.brief_filename === 'string' ? filesRow.brief_filename : '',
    },
    ai: {
      signalTitle: aiRow && typeof aiRow.signal_title === 'string' ? aiRow.signal_title : '',
      signalParagraphs: parseJsonArray(aiRow?.signal_paragraphs_json),
      carryForward: aiRow && typeof aiRow.carry_forward === 'string' ? aiRow.carry_forward : '',
      nextRunTitle: aiRow && typeof aiRow.next_run_title === 'string' ? aiRow.next_run_title : '',
      nextRunSummary: aiRow && typeof aiRow.next_run_summary === 'string' ? aiRow.next_run_summary : '',
      nextRunDurationMin: aiRow && typeof aiRow.next_run_duration_min === 'number' ? aiRow.next_run_duration_min : null,
      nextRunDurationMax: aiRow && typeof aiRow.next_run_duration_max === 'number' ? aiRow.next_run_duration_max : null,
      nextRunPaceMinSecPerKm: aiRow && typeof aiRow.next_run_pace_min_sec_per_km === 'number' ? aiRow.next_run_pace_min_sec_per_km : null,
      nextRunPaceMaxSecPerKm: aiRow && typeof aiRow.next_run_pace_max_sec_per_km === 'number' ? aiRow.next_run_pace_max_sec_per_km : null,
      weekTitle: aiRow && typeof aiRow.week_title === 'string' ? aiRow.week_title : '',
      weekSummary: aiRow && typeof aiRow.week_summary === 'string' ? aiRow.week_summary : '',
      modelName: aiRow && typeof aiRow.model_name === 'string' ? aiRow.model_name : null,
      promptVersion: aiRow && typeof aiRow.prompt_version === 'string' ? aiRow.prompt_version : null,
      generatedAt: aiRow && typeof aiRow.generated_at === 'string' ? aiRow.generated_at : null,
    },
  };
}

export function initSessionStore(): void {
  getDatabase();
}

export function getStoredSessionBySourceActivityId(sourceActivityId: number): StoredSession | null {
  const db = getDatabase();
  const coreRow = db.prepare(`
    SELECT *
    FROM sessions
    WHERE source_activity_id = ?
  `).get(sourceActivityId) as Record<string, unknown> | undefined;

  return coreRow ? mapSession(db, coreRow) : null;
}

export function listStoredSessions(): StoredSession[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT *
    FROM sessions
    ORDER BY session_date DESC, start_date_local DESC, id DESC
  `).all() as Record<string, unknown>[];

  return rows.map((row) => mapSession(db, row));
}

export function listPublishedSessions(): StoredSession[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT *
    FROM sessions
    WHERE published_at IS NOT NULL
    ORDER BY session_date DESC, start_date_local DESC, id DESC
  `).all() as Record<string, unknown>[];

  return rows.map((row) => mapSession(db, row));
}

export function listStoredSessionSummaries(): StoredSessionSummary[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.id, s.source_activity_id, s.session_date, s.title, s.sport, s.distance_m, s.updated_at, s.published_at, ai.signal_title
    FROM sessions s
    LEFT JOIN session_ai ai ON ai.session_id = s.id
    ORDER BY s.session_date DESC, s.id DESC
  `).all() as Record<string, unknown>[];

  return rows.map((row) => ({
    sessionId: Number(row.id),
    sourceActivityId: Number(row.source_activity_id),
    sessionDate: String(row.session_date),
    title: String(row.title),
    sport: String(row.sport),
    distanceM: typeof row.distance_m === 'number' ? row.distance_m : null,
    updatedAt: String(row.updated_at),
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
    signalTitle: toNullableText(row.signal_title),
  }));
}

export function markSessionPublished(sessionId: number, publishedAt = new Date().toISOString()): StoredSession {
  const db = getDatabase();
  db.prepare(`
    UPDATE sessions
    SET published_at = ?
    WHERE id = ?
  `).run(publishedAt, sessionId);

  const row = db.prepare(`
    SELECT *
    FROM sessions
    WHERE id = ?
  `).get(sessionId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(`Could not reload published session ${sessionId}.`);
  }

  return mapSession(db, row);
}

export function saveStoredSession(input: PersistedSessionInput): StoredSession {
  const db = getDatabase();
  const existing = getStoredSessionBySourceActivityId(input.core.sourceActivityId);
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO sessions (
        session_date, start_date_local, title, sport, source, source_activity_id, distance_m, moving_time_s,
        elapsed_time_s, pace_sec_per_km, hr_avg, hr_max, elevation_m, weather_temp_c,
        weather_condition, weather_wind_kmh, polyline, city, created_at, updated_at
      ) VALUES (
        @session_date, @start_date_local, @title, @sport, @source, @source_activity_id, @distance_m, @moving_time_s,
        @elapsed_time_s, @pace_sec_per_km, @hr_avg, @hr_max, @elevation_m, @weather_temp_c,
        @weather_condition, @weather_wind_kmh, @polyline, @city, @created_at, @updated_at
      )
      ON CONFLICT(source_activity_id) DO UPDATE SET
        session_date = excluded.session_date,
        start_date_local = COALESCE(excluded.start_date_local, sessions.start_date_local),
        title = excluded.title,
        sport = excluded.sport,
        source = excluded.source,
        distance_m = excluded.distance_m,
        moving_time_s = excluded.moving_time_s,
        elapsed_time_s = excluded.elapsed_time_s,
        pace_sec_per_km = excluded.pace_sec_per_km,
        hr_avg = excluded.hr_avg,
        hr_max = excluded.hr_max,
        elevation_m = excluded.elevation_m,
        weather_temp_c = excluded.weather_temp_c,
        weather_condition = excluded.weather_condition,
        weather_wind_kmh = excluded.weather_wind_kmh,
        polyline = excluded.polyline,
        city = excluded.city,
        updated_at = excluded.updated_at
    `).run({
      session_date: input.core.sessionDate,
      start_date_local: toNullableText(input.core.startDateLocal),
      title: input.core.title,
      sport: input.core.sport,
      source: input.core.source,
      source_activity_id: input.core.sourceActivityId,
      distance_m: input.core.distanceM,
      moving_time_s: input.core.movingTimeS,
      elapsed_time_s: input.core.elapsedTimeS,
      pace_sec_per_km: input.core.paceSecPerKm,
      hr_avg: input.core.hrAvg,
      hr_max: input.core.hrMax,
      elevation_m: input.core.elevationM,
      weather_temp_c: input.core.weatherTempC,
      weather_condition: input.core.weatherCondition,
      weather_wind_kmh: input.core.weatherWindKmh,
      polyline: input.core.polyline,
      city: input.core.city,
      created_at: existing?.core.createdAt ?? now,
      updated_at: now,
    });

    const sessionIdRow = db.prepare(`
      SELECT id
      FROM sessions
      WHERE source_activity_id = ?
    `).get(input.core.sourceActivityId) as { id: number };

    const sessionId = Number(sessionIdRow.id);

    db.prepare(`
      INSERT INTO session_manual (session_id, session_type, legs, sleep_score, restedness, extra_notes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        session_type = excluded.session_type,
        legs = excluded.legs,
        sleep_score = excluded.sleep_score,
        restedness = excluded.restedness,
        extra_notes = excluded.extra_notes
    `).run(
      sessionId,
      toNullableText(input.manual.sessionType),
      toNullableText(input.manual.legs),
      input.manual.sleepScore,
      toNullableText(input.manual.restedness),
      toNullableText(input.manual.extraNotes),
    );

    db.prepare(`
      INSERT INTO session_files (session_id, tcx_filename, tcx_attached, brief_filename)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        tcx_filename = excluded.tcx_filename,
        tcx_attached = excluded.tcx_attached,
        brief_filename = excluded.brief_filename
    `).run(
      sessionId,
      toNullableText(input.files.tcxFilename),
      input.files.tcxAttached ? 1 : 0,
      toNullableText(input.files.briefFilename),
    );

    db.prepare(`
      INSERT INTO session_ai (
        session_id, signal_title, signal_paragraphs_json, carry_forward, next_run_title,
        next_run_summary, next_run_duration_min, next_run_duration_max,
        next_run_pace_min_sec_per_km, next_run_pace_max_sec_per_km, week_title,
        week_summary, model_name, prompt_version, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        signal_title = excluded.signal_title,
        signal_paragraphs_json = excluded.signal_paragraphs_json,
        carry_forward = excluded.carry_forward,
        next_run_title = excluded.next_run_title,
        next_run_summary = excluded.next_run_summary,
        next_run_duration_min = excluded.next_run_duration_min,
        next_run_duration_max = excluded.next_run_duration_max,
        next_run_pace_min_sec_per_km = excluded.next_run_pace_min_sec_per_km,
        next_run_pace_max_sec_per_km = excluded.next_run_pace_max_sec_per_km,
        week_title = excluded.week_title,
        week_summary = excluded.week_summary,
        model_name = excluded.model_name,
        prompt_version = excluded.prompt_version,
        generated_at = excluded.generated_at
    `).run(
      sessionId,
      toNullableText(input.ai.signalTitle),
      JSON.stringify(input.ai.signalParagraphs),
      toNullableText(input.ai.carryForward),
      toNullableText(input.ai.nextRunTitle),
      toNullableText(input.ai.nextRunSummary),
      input.ai.nextRunDurationMin,
      input.ai.nextRunDurationMax,
      input.ai.nextRunPaceMinSecPerKm,
      input.ai.nextRunPaceMaxSecPerKm,
      toNullableText(input.ai.weekTitle),
      toNullableText(input.ai.weekSummary),
      toNullableText(input.ai.modelName),
      toNullableText(input.ai.promptVersion),
      toNullableText(input.ai.generatedAt),
    );

    db.prepare(`
      DELETE FROM session_laps
      WHERE session_id = ?
    `).run(sessionId);

    const lapStatement = db.prepare(`
      INSERT INTO session_laps (session_id, lap_index, distance_m, duration_s, pace_sec_per_km, hr_avg)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const lap of input.laps) {
      lapStatement.run(
        sessionId,
        lap.lapIndex,
        lap.distanceM,
        lap.durationS,
        lap.paceSecPerKm,
        lap.hrAvg,
      );
    }
  });

  transaction();

  const saved = getStoredSessionBySourceActivityId(input.core.sourceActivityId);
  if (!saved) {
    throw new Error(`Could not reload saved session ${input.core.sourceActivityId}.`);
  }

  return saved;
}

export function upsertWeeklySnapshot(input: Omit<WeeklySnapshotRecord, 'id'>): WeeklySnapshotRecord {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO weekly_snapshots (
      snapshot_date, window_start, window_end, total_km, total_runs, total_time_s, title, summary, bars_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      window_start = excluded.window_start,
      window_end = excluded.window_end,
      total_km = excluded.total_km,
      total_runs = excluded.total_runs,
      total_time_s = excluded.total_time_s,
      title = excluded.title,
      summary = excluded.summary,
      bars_json = excluded.bars_json
  `).run(
    input.snapshotDate,
    input.windowStart,
    input.windowEnd,
    input.totalKm,
    input.totalRuns,
    input.totalTimeS,
    toNullableText(input.title),
    toNullableText(input.summary),
    JSON.stringify(input.bars),
  );

  const row = db.prepare(`
    SELECT *
    FROM weekly_snapshots
    WHERE snapshot_date = ?
  `).get(input.snapshotDate) as Record<string, unknown>;

  return {
    id: Number(row.id),
    snapshotDate: String(row.snapshot_date),
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    totalKm: Number(row.total_km),
    totalRuns: Number(row.total_runs),
    totalTimeS: Number(row.total_time_s),
    title: toNullableText(row.title),
    summary: toNullableText(row.summary),
    bars: JSON.parse(String(row.bars_json)) as WeeklyBar[],
  };
}

export function getLatestWeeklySnapshot(): WeeklySnapshotRecord | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT *
    FROM weekly_snapshots
    ORDER BY snapshot_date DESC, id DESC
    LIMIT 1
  `).get() as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: Number(row.id),
    snapshotDate: String(row.snapshot_date),
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    totalKm: Number(row.total_km),
    totalRuns: Number(row.total_runs),
    totalTimeS: Number(row.total_time_s),
    title: toNullableText(row.title),
    summary: toNullableText(row.summary),
    bars: JSON.parse(String(row.bars_json)) as WeeklyBar[],
  };
}
