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
  SessionNextRunWorkout,
  StoredSession,
  StoredSessionSummary,
  WeeklyBar,
  WeeklySnapshotRecord,
} from './types';
import type { FutureWorkoutLifecycle, FutureWorkoutProposal } from '../workouts/types';
import { futureWorkoutIdentityKey } from '../workouts/contract';

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
    nextRunDistanceKm: number | null;
    nextRunPaceMinSecPerKm: number | null;
    nextRunPaceMaxSecPerKm: number | null;
    nextRunWorkout: SessionNextRunWorkout | null;
    weekTitle: string;
    weekSummary: string;
  };
  laps: SessionLapRecord[];
}

export interface SessionFingerprintInput {
  sessionDate: string;
  sport: string;
  startDateLocal: string | null;
  distanceM: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
}

type SqliteDatabase = Database.Database;

export interface StoredFutureWorkoutRevision {
  revision: number;
  action: 'imported' | 'revised' | 'approved';
  recordedAt: string;
  proposal: FutureWorkoutProposal;
}

export interface StoredFutureWorkout {
  workout: FutureWorkoutProposal;
  createdAt: string;
  storedAt: string;
  revisions: StoredFutureWorkoutRevision[];
  skip: StoredFutureWorkoutSkip | null;
}

export interface StoredFutureWorkoutSkip {
  pacerWorkoutId: string;
  skippedAt: string;
  explanation: string | null;
  wellnessSnapshot: unknown;
  wellnessCollectedAt: string;
  wellnessProvenance: unknown;
  conflictActivityId: number | null;
  conflictDetectedAt: string | null;
  planningAnchor: { sourceActivityId: number; sessionDate: string; title: string } | null;
}

export interface StoredFutureWorkoutRemoteCancellation {
  pacerWorkoutId: string;
  intervalsEventId: string;
  externalId: string;
  status: 'deleted' | 'already_absent' | 'failed';
  attemptedAt: string;
  error: string | null;
}

export interface FutureWorkoutImportResult {
  operation: 'created' | 'unchanged' | 'revised';
  stored: StoredFutureWorkout;
}

export interface StoredFutureWorkoutRenameInput {
  pacerWorkoutId: string;
  proposalKey: string;
  expectedTitle: string;
  nextTitle: string;
  expectedIntervalsEventId: string;
  dryRun?: boolean;
}

export interface StoredSessionFeedbackUpdateInput {
  sessionId: number;
  sourceActivityId: number;
  sessionDate: string;
  expectedLapCount: number;
  expected: { signalTitle: string; signalParagraphs: string[]; carryForward: string };
  next: { signalTitle: string; signalParagraphs: string[]; carryForward: string };
  dryRun?: boolean;
}

export interface StoredSessionNextRunTitleUpdateInput {
  sessionId: number;
  sourceActivityId: number;
  sessionDate: string;
  expectedLapCount: number;
  expectedNextRunTitle: string;
  nextRunTitle: string;
  dryRun?: boolean;
}

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
          lap_source TEXT,
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

  if (currentVersion < 4) {
    const migrationV4 = db.transaction(() => {
      if (!columnExists(db, 'session_ai', 'next_run_workout_json')) {
        db.exec(`
          ALTER TABLE session_ai ADD COLUMN next_run_workout_json TEXT;
        `);
      }

      db.pragma('user_version = 4');
    });

    migrationV4();
  }

  if (currentVersion < 5) {
    const migrationV5 = db.transaction(() => {
      if (!columnExists(db, 'session_ai', 'next_run_distance_km')) {
        db.exec(`
          ALTER TABLE session_ai ADD COLUMN next_run_distance_km REAL;
        `);
      }

      db.pragma('user_version = 5');
    });

    migrationV5();
  }

  if (currentVersion < 6) {
    const migrationV6 = db.transaction(() => {
      if (!columnExists(db, 'session_laps', 'lap_source')) {
        db.exec(`
          ALTER TABLE session_laps ADD COLUMN lap_source TEXT;
        `);
      }

      db.pragma('user_version = 6');
    });

    migrationV6();
  }

  if (currentVersion < 7) {
    const migrationV7 = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS future_workouts (
          pacer_workout_id TEXT PRIMARY KEY,
          identity_key TEXT NOT NULL UNIQUE,
          proposal_key TEXT NOT NULL,
          proposal_revision INTEGER NOT NULL,
          source_activity_id INTEGER NOT NULL,
          source_session_date TEXT NOT NULL,
          scheduled_local_date TEXT NOT NULL,
          timezone TEXT NOT NULL,
          workout_type TEXT NOT NULL,
          title TEXT NOT NULL,
          coaching_notes TEXT NOT NULL,
          proposal_json TEXT NOT NULL,
          approval_status TEXT NOT NULL CHECK (approval_status IN ('proposed', 'approved', 'rejected', 'superseded')),
          approved_at TEXT,
          approval_note TEXT,
          sync_status TEXT NOT NULL CHECK (sync_status IN ('not_requested', 'syncing', 'synced', 'failed')),
          synced_at TEXT,
          intervals_event_id TEXT,
          last_sync_error TEXT,
          created_at TEXT NOT NULL,
          stored_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS future_workout_revisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pacer_workout_id TEXT NOT NULL,
          proposal_revision INTEGER NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('imported', 'revised', 'approved')),
          proposal_json TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          UNIQUE(pacer_workout_id, proposal_revision, action),
          FOREIGN KEY (pacer_workout_id) REFERENCES future_workouts(pacer_workout_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_future_workouts_schedule ON future_workouts(scheduled_local_date ASC, pacer_workout_id ASC);
        CREATE INDEX IF NOT EXISTS idx_future_workouts_source ON future_workouts(source_activity_id, source_session_date);
        CREATE INDEX IF NOT EXISTS idx_future_workout_revisions_workout ON future_workout_revisions(pacer_workout_id, id ASC);
      `);
      db.pragma('user_version = 7');
    });

    migrationV7();
  }
  if (currentVersion < 8) {
    // SQLite cannot alter a CHECK constraint. Rebuild the v7 table inside one
    // transaction; foreign keys are temporarily disabled only for the swap.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
      db.exec(`CREATE TABLE future_workouts_v8 (
          pacer_workout_id TEXT PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE,
          proposal_key TEXT NOT NULL, proposal_revision INTEGER NOT NULL,
          source_activity_id INTEGER NOT NULL, source_session_date TEXT NOT NULL,
          scheduled_local_date TEXT NOT NULL, timezone TEXT NOT NULL,
          workout_type TEXT NOT NULL, title TEXT NOT NULL, coaching_notes TEXT NOT NULL,
          proposal_json TEXT NOT NULL,
          approval_status TEXT NOT NULL CHECK (approval_status IN ('proposed','approved','rejected','superseded')),
          approved_at TEXT, approval_note TEXT,
          sync_status TEXT NOT NULL CHECK (sync_status IN ('not_requested','syncing','synced','failed')),
          synced_at TEXT, intervals_event_id TEXT, last_sync_error TEXT,
          sync_attempted_at TEXT, created_at TEXT NOT NULL, stored_at TEXT NOT NULL
        );
        INSERT INTO future_workouts_v8 (
          pacer_workout_id,identity_key,proposal_key,proposal_revision,source_activity_id,source_session_date,
          scheduled_local_date,timezone,workout_type,title,coaching_notes,proposal_json,approval_status,
          approved_at,approval_note,sync_status,synced_at,intervals_event_id,last_sync_error,created_at,stored_at
        ) SELECT pacer_workout_id,identity_key,proposal_key,proposal_revision,source_activity_id,source_session_date,
          scheduled_local_date,timezone,workout_type,title,coaching_notes,proposal_json,approval_status,
          approved_at,approval_note,sync_status,synced_at,intervals_event_id,last_sync_error,created_at,stored_at
          FROM future_workouts;`);
        if (process.env.PACER_TEST_FAIL_V8_MIGRATION === 'true') {
          throw new Error('Injected v8 migration failure.');
        }
        db.exec(`
        DROP TABLE future_workouts;
        ALTER TABLE future_workouts_v8 RENAME TO future_workouts;
        CREATE INDEX idx_future_workouts_schedule ON future_workouts(scheduled_local_date ASC, pacer_workout_id ASC);
        CREATE INDEX idx_future_workouts_source ON future_workouts(source_activity_id, source_session_date);
        CREATE TABLE IF NOT EXISTS future_workout_sync_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, pacer_workout_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('syncing','synced','failed')),
          remote_event_id TEXT, error TEXT, attempted_at TEXT NOT NULL,
          FOREIGN KEY (pacer_workout_id) REFERENCES future_workouts(pacer_workout_id) ON DELETE CASCADE
        );`);
      db.pragma('user_version = 8');
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  if (currentVersion < 9) {
    // Additive: records the real outcome of each publish so "Published" is not inferred from published_at,
    // which is stamped before the deploy runs.
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_publish_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
          ok INTEGER NOT NULL, message TEXT NOT NULL, attempted_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_session_publish_attempts_session ON session_publish_attempts(session_id, id DESC);`);
      db.pragma('user_version = 9');
    })();
  }
  if (currentVersion < 10) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS future_workout_skips (
          pacer_workout_id TEXT PRIMARY KEY,
          skipped_at TEXT NOT NULL,
          explanation TEXT,
          wellness_snapshot_json TEXT NOT NULL,
          wellness_collected_at TEXT NOT NULL,
          wellness_provenance_json TEXT NOT NULL,
          conflict_activity_id INTEGER,
          conflict_detected_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (pacer_workout_id) REFERENCES future_workouts(pacer_workout_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_future_workout_skips_conflict ON future_workout_skips(conflict_activity_id);
      `);
      db.pragma('user_version = 10');
    })();
  }
  if (currentVersion < 11) {
    db.transaction(() => {
      if (!columnExists(db, 'future_workout_skips', 'planning_anchor_json')) {
        db.exec(`ALTER TABLE future_workout_skips ADD COLUMN planning_anchor_json TEXT;`);
      }
      db.pragma('user_version = 11');
    })();
  }
  if (currentVersion < 12) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS future_workout_publications (
          pacer_workout_id TEXT PRIMARY KEY,
          ok INTEGER NOT NULL,
          message TEXT NOT NULL,
          attempted_at TEXT NOT NULL,
          published_at TEXT,
          FOREIGN KEY (pacer_workout_id) REFERENCES future_workouts(pacer_workout_id) ON DELETE CASCADE
        );
      `);
      db.pragma('user_version = 12');
    })();
  }
  if (currentVersion < 13) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS future_workout_remote_cancellations (
          pacer_workout_id TEXT PRIMARY KEY,
          intervals_event_id TEXT NOT NULL,
          external_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('deleted','already_absent','failed')),
          attempted_at TEXT NOT NULL,
          error TEXT,
          FOREIGN KEY (pacer_workout_id) REFERENCES future_workouts(pacer_workout_id) ON DELETE CASCADE
        );
      `);
      db.pragma('user_version = 13');
    })();
  }
}

export interface StoredSessionPublishAttempt { ok: boolean; message: string; attemptedAt: string; }
export interface StoredFutureWorkoutPublication { ok: boolean; message: string; attemptedAt: string; publishedAt: string | null; }

export function getStoredFutureWorkoutPublication(pacerWorkoutId: string): StoredFutureWorkoutPublication | null {
  const row = getDatabase().prepare('SELECT ok, message, attempted_at, published_at FROM future_workout_publications WHERE pacer_workout_id = ?')
    .get(pacerWorkoutId) as { ok: number; message: string; attempted_at: string; published_at: string | null } | undefined;
  return row ? { ok: row.ok === 1, message: row.message, attemptedAt: row.attempted_at, publishedAt: row.published_at } : null;
}

export function recordStoredFutureWorkoutPublication(pacerWorkoutId: string, ok: boolean, message: string): StoredFutureWorkoutPublication {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO future_workout_publications (pacer_workout_id, ok, message, attempted_at, published_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(pacer_workout_id) DO UPDATE SET ok=excluded.ok, message=excluded.message, attempted_at=excluded.attempted_at,
      published_at=CASE WHEN excluded.ok=1 THEN excluded.published_at ELSE future_workout_publications.published_at END
  `).run(pacerWorkoutId, ok ? 1 : 0, message.slice(0, 500), now, ok ? now : null);
  return getStoredFutureWorkoutPublication(pacerWorkoutId)!;
}

export function recordSessionPublishAttempt(sessionId: number, ok: boolean, message: string): void {
  getDatabase().prepare('INSERT INTO session_publish_attempts (session_id, ok, message, attempted_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, ok ? 1 : 0, message.slice(0, 500), new Date().toISOString());
}

export function getLatestSessionPublishAttempt(sessionId: number): StoredSessionPublishAttempt | null {
  const row = getDatabase().prepare('SELECT ok, message, attempted_at FROM session_publish_attempts WHERE session_id = ? ORDER BY id DESC LIMIT 1')
    .get(sessionId) as { ok: number; message: string; attempted_at: string } | undefined;
  return row ? { ok: row.ok === 1, message: row.message, attemptedAt: row.attempted_at } : null;
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

function parseNextRunWorkout(value: unknown): SessionNextRunWorkout | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const type = (parsed as { type?: unknown }).type;
    const title = (parsed as { title?: unknown }).title;
    const blocks = (parsed as { blocks?: unknown }).blocks;

    if (typeof type !== 'string' || !type.trim() || !Array.isArray(blocks)) return null;

    const normalizedBlocks = blocks
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trimEnd())
      .filter((entry) => entry.trim());

    if (normalizedBlocks.length === 0) return null;

    return {
      ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
      type: type.trim(),
      blocks: normalizedBlocks,
    };
  } catch {
    return null;
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
    SELECT id, lap_index, distance_m, duration_s, pace_sec_per_km, hr_avg, lap_source
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
           next_run_duration_min, next_run_duration_max, next_run_distance_km, next_run_pace_min_sec_per_km,
           next_run_pace_max_sec_per_km, next_run_workout_json, week_title, week_summary, model_name,
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
      lapSource: row.lap_source === 'intervals' || row.lap_source === 'tcx' ? row.lap_source : 'none',
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
      sourceActivityId: core.sourceActivityId,
      sessionDate: core.sessionDate,
      signalTitle: aiRow && typeof aiRow.signal_title === 'string' ? aiRow.signal_title : '',
      signalParagraphs: parseJsonArray(aiRow?.signal_paragraphs_json),
      carryForward: aiRow && typeof aiRow.carry_forward === 'string' ? aiRow.carry_forward : '',
      nextRunTitle: aiRow && typeof aiRow.next_run_title === 'string' ? aiRow.next_run_title : '',
      nextRunSummary: aiRow && typeof aiRow.next_run_summary === 'string' ? aiRow.next_run_summary : '',
      nextRunDurationMin: aiRow && typeof aiRow.next_run_duration_min === 'number' ? aiRow.next_run_duration_min : null,
      nextRunDurationMax: aiRow && typeof aiRow.next_run_duration_max === 'number' ? aiRow.next_run_duration_max : null,
      nextRunDistanceKm: aiRow && typeof aiRow.next_run_distance_km === 'number' ? aiRow.next_run_distance_km : null,
      nextRunPaceMinSecPerKm: aiRow && typeof aiRow.next_run_pace_min_sec_per_km === 'number' ? aiRow.next_run_pace_min_sec_per_km : null,
      nextRunPaceMaxSecPerKm: aiRow && typeof aiRow.next_run_pace_max_sec_per_km === 'number' ? aiRow.next_run_pace_max_sec_per_km : null,
      nextRunWorkout: parseNextRunWorkout(aiRow?.next_run_workout_json),
      weekTitle: aiRow && typeof aiRow.week_title === 'string' ? aiRow.week_title : '',
      weekSummary: aiRow && typeof aiRow.week_summary === 'string' ? aiRow.week_summary : '',
      modelName: aiRow && typeof aiRow.model_name === 'string' ? aiRow.model_name : null,
      promptVersion: aiRow && typeof aiRow.prompt_version === 'string' ? aiRow.prompt_version : null,
      generatedAt: aiRow && typeof aiRow.generated_at === 'string' ? aiRow.generated_at : null,
    },
  };
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const localParts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  const timestamp = localParts
    ? Date.UTC(
      Number(localParts[1]),
      Number(localParts[2]) - 1,
      Number(localParts[3]),
      Number(localParts[4]),
      Number(localParts[5]),
      Number(localParts[6] ?? '0'),
    )
    : Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function withinTolerance(left: number | null, right: number | null, tolerance: number): boolean {
  if (left === null || right === null) return true;
  return Math.abs(left - right) <= tolerance;
}

function fingerprintMatches(session: StoredSession, fingerprint: SessionFingerprintInput): boolean {
  if (session.core.sessionDate !== fingerprint.sessionDate || session.core.sport !== fingerprint.sport) {
    return false;
  }

  const sessionTime = parseTimestamp(session.core.startDateLocal);
  const inputTime = parseTimestamp(fingerprint.startDateLocal);
  const timeMatches = sessionTime === null || inputTime === null || Math.abs(sessionTime - inputTime) <= 10 * 60 * 1000;

  return timeMatches
    && withinTolerance(session.core.distanceM, fingerprint.distanceM, 150)
    && withinTolerance(session.core.movingTimeS, fingerprint.movingTimeS, 180)
    && withinTolerance(session.core.elapsedTimeS, fingerprint.elapsedTimeS, 240);
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

export function getStoredSessionByActivityFingerprint(fingerprint: SessionFingerprintInput): StoredSession | null {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT *
    FROM sessions
    WHERE session_date = ? AND sport = ?
    ORDER BY published_at DESC, updated_at DESC, id DESC
  `).all(fingerprint.sessionDate, fingerprint.sport) as Record<string, unknown>[];

  for (const row of rows) {
    const session = mapSession(db, row);
    if (fingerprintMatches(session, fingerprint)) {
      return session;
    }
  }

  return null;
}

export function reassignSessionSourceActivityId(sessionId: number, source: string, sourceActivityId: number): StoredSession {
  const db = getDatabase();
  const conflicting = getStoredSessionBySourceActivityId(sourceActivityId);
  if (conflicting && conflicting.core.id !== sessionId) {
    throw new Error(`Source activity ${sourceActivityId} is already attached to session ${conflicting.core.id}.`);
  }

  db.prepare(`
    UPDATE sessions
    SET source = ?, source_activity_id = ?, updated_at = ?
    WHERE id = ?
  `).run(source, sourceActivityId, new Date().toISOString(), sessionId);

  const saved = getStoredSessionBySourceActivityId(sourceActivityId);
  if (!saved) {
    throw new Error(`Could not reassign session ${sessionId} to source activity ${sourceActivityId}.`);
  }

  return saved;
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
        next_run_summary, next_run_duration_min, next_run_duration_max, next_run_distance_km,
        next_run_pace_min_sec_per_km, next_run_pace_max_sec_per_km, next_run_workout_json, week_title,
        week_summary, model_name, prompt_version, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        signal_title = excluded.signal_title,
        signal_paragraphs_json = excluded.signal_paragraphs_json,
        carry_forward = excluded.carry_forward,
        next_run_title = excluded.next_run_title,
        next_run_summary = excluded.next_run_summary,
        next_run_duration_min = excluded.next_run_duration_min,
        next_run_duration_max = excluded.next_run_duration_max,
        next_run_distance_km = excluded.next_run_distance_km,
        next_run_pace_min_sec_per_km = excluded.next_run_pace_min_sec_per_km,
        next_run_pace_max_sec_per_km = excluded.next_run_pace_max_sec_per_km,
        next_run_workout_json = excluded.next_run_workout_json,
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
      input.ai.nextRunDistanceKm,
      input.ai.nextRunPaceMinSecPerKm,
      input.ai.nextRunPaceMaxSecPerKm,
      input.ai.nextRunWorkout ? JSON.stringify(input.ai.nextRunWorkout) : null,
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
      INSERT INTO session_laps (session_id, lap_index, distance_m, duration_s, pace_sec_per_km, hr_avg, lap_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const lap of input.laps) {
      lapStatement.run(
        sessionId,
        lap.lapIndex,
        lap.distanceM,
        lap.durationS,
        lap.paceSecPerKm,
        lap.hrAvg,
        lap.lapSource ?? 'none',
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

function futureWorkoutLifecycleFromRow(row: Record<string, unknown>): FutureWorkoutLifecycle {
  return {
    approvalStatus: String(row.approval_status) as FutureWorkoutLifecycle['approvalStatus'],
    approvedAt: typeof row.approved_at === 'string' ? row.approved_at : null,
    approvalNote: typeof row.approval_note === 'string' ? row.approval_note : null,
    syncStatus: String(row.sync_status) as FutureWorkoutLifecycle['syncStatus'],
    syncedAt: typeof row.synced_at === 'string' ? row.synced_at : null,
    intervalsEventId: typeof row.intervals_event_id === 'string' ? row.intervals_event_id : null,
    lastSyncError: typeof row.last_sync_error === 'string' ? row.last_sync_error : null,
  };
}

function parseStoredFutureWorkout(row: Record<string, unknown>): FutureWorkoutProposal {
  let proposal: FutureWorkoutProposal;
  try {
    proposal = JSON.parse(String(row.proposal_json)) as FutureWorkoutProposal;
  } catch {
    throw new Error(`Stored future workout ${String(row.pacer_workout_id)} has invalid proposal JSON.`);
  }
  return { ...proposal, lifecycle: futureWorkoutLifecycleFromRow(row) };
}

function futureWorkoutRevisions(db: SqliteDatabase, pacerWorkoutId: string): StoredFutureWorkoutRevision[] {
  const rows = db.prepare(`
    SELECT proposal_revision, action, proposal_json, recorded_at
    FROM future_workout_revisions
    WHERE pacer_workout_id = ?
    ORDER BY id ASC
  `).all(pacerWorkoutId) as Record<string, unknown>[];

  return rows.map((row) => ({
    revision: Number(row.proposal_revision),
    action: String(row.action) as StoredFutureWorkoutRevision['action'],
    proposal: JSON.parse(String(row.proposal_json)) as FutureWorkoutProposal,
    recordedAt: String(row.recorded_at),
  }));
}

function mapStoredFutureWorkout(db: SqliteDatabase, row: Record<string, unknown>): StoredFutureWorkout {
  const pacerWorkoutId = String(row.pacer_workout_id);
  return {
    workout: parseStoredFutureWorkout(row),
    createdAt: String(row.created_at),
    storedAt: String(row.stored_at),
    revisions: futureWorkoutRevisions(db, pacerWorkoutId),
    skip: getStoredFutureWorkoutSkipFromDatabase(db, pacerWorkoutId),
  };
}

function getStoredFutureWorkoutSkipFromDatabase(db: SqliteDatabase, pacerWorkoutId: string): StoredFutureWorkoutSkip | null {
  const row = db.prepare(`SELECT * FROM future_workout_skips WHERE pacer_workout_id=?`).get(pacerWorkoutId) as Record<string, unknown> | undefined;
  if (!row) return null;
  try {
    return {
      pacerWorkoutId,
      skippedAt: String(row.skipped_at),
      explanation: typeof row.explanation === 'string' ? row.explanation : null,
      wellnessSnapshot: JSON.parse(String(row.wellness_snapshot_json)),
      wellnessCollectedAt: String(row.wellness_collected_at),
      wellnessProvenance: JSON.parse(String(row.wellness_provenance_json)),
      conflictActivityId: typeof row.conflict_activity_id === 'number' ? row.conflict_activity_id : null,
      conflictDetectedAt: typeof row.conflict_detected_at === 'string' ? row.conflict_detected_at : null,
      planningAnchor: typeof row.planning_anchor_json === 'string' && row.planning_anchor_json
        ? JSON.parse(row.planning_anchor_json) as StoredFutureWorkoutSkip['planningAnchor'] : null,
    };
  } catch {
    throw new Error(`Stored skip for future workout ${pacerWorkoutId} has invalid JSON.`);
  }
}

export function getStoredFutureWorkoutSkip(pacerWorkoutId: string): StoredFutureWorkoutSkip | null {
  return getStoredFutureWorkoutSkipFromDatabase(getDatabase(), pacerWorkoutId);
}

export function getStoredFutureWorkoutRemoteCancellation(pacerWorkoutId: string): StoredFutureWorkoutRemoteCancellation | null {
  const row = getDatabase().prepare(`SELECT * FROM future_workout_remote_cancellations WHERE pacer_workout_id=?`).get(pacerWorkoutId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    pacerWorkoutId,
    intervalsEventId: String(row.intervals_event_id),
    externalId: String(row.external_id),
    status: String(row.status) as StoredFutureWorkoutRemoteCancellation['status'],
    attemptedAt: String(row.attempted_at),
    error: typeof row.error === 'string' ? row.error : null,
  };
}

export function recordStoredFutureWorkoutRemoteCancellation(input: Omit<StoredFutureWorkoutRemoteCancellation, 'attemptedAt'>): StoredFutureWorkoutRemoteCancellation {
  const attemptedAt = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO future_workout_remote_cancellations (
      pacer_workout_id, intervals_event_id, external_id, status, attempted_at, error
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(pacer_workout_id) DO UPDATE SET
      intervals_event_id=excluded.intervals_event_id, external_id=excluded.external_id,
      status=excluded.status, attempted_at=excluded.attempted_at, error=excluded.error
  `).run(input.pacerWorkoutId, input.intervalsEventId, input.externalId, input.status, attemptedAt, input.error);
  const cancellation = getStoredFutureWorkoutRemoteCancellation(input.pacerWorkoutId);
  if (!cancellation) throw new Error('Could not reload remote cancellation state.');
  return cancellation;
}

export function createStoredFutureWorkoutSkip(input: Omit<StoredFutureWorkoutSkip, 'conflictActivityId' | 'conflictDetectedAt'>): { operation: 'created' | 'unchanged'; skip: StoredFutureWorkoutSkip } {
  const db = getDatabase();
  const operation = db.transaction(() => {
    const workout = getStoredFutureWorkoutRow(db, input.pacerWorkoutId);
    if (!workout) throw new Error('Future workout not found.');
    if (String(workout.approval_status) !== 'approved') throw new Error('Only approved future workouts can be skipped.');
    if (String(workout.sync_status) === 'syncing') throw new Error('A workout being synchronized cannot be skipped.');
    if (getStoredFutureWorkoutSkipFromDatabase(db, input.pacerWorkoutId)) return 'unchanged' as const;
    db.prepare(`INSERT INTO future_workout_skips (
      pacer_workout_id, skipped_at, explanation, wellness_snapshot_json, wellness_collected_at,
      wellness_provenance_json, planning_anchor_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.pacerWorkoutId, input.skippedAt, input.explanation, JSON.stringify(input.wellnessSnapshot), input.wellnessCollectedAt,
        JSON.stringify(input.wellnessProvenance), input.planningAnchor ? JSON.stringify(input.planningAnchor) : null, input.skippedAt);
    return 'created' as const;
  })();
  const skip = getStoredFutureWorkoutSkip(input.pacerWorkoutId);
  if (!skip) throw new Error('Could not reload stored workout skip.');
  return { operation, skip };
}

export function recordStoredFutureWorkoutSkipConflict(pacerWorkoutId: string, activityId: number): StoredFutureWorkoutSkip | null {
  const db = getDatabase();
  const existing = getStoredFutureWorkoutSkipFromDatabase(db, pacerWorkoutId);
  if (!existing || existing.conflictActivityId === activityId) return existing;
  db.prepare(`UPDATE future_workout_skips SET conflict_activity_id=?, conflict_detected_at=? WHERE pacer_workout_id=?`)
    .run(activityId, new Date().toISOString(), pacerWorkoutId);
  return getStoredFutureWorkoutSkipFromDatabase(db, pacerWorkoutId);
}

function getStoredFutureWorkoutRow(db: SqliteDatabase, pacerWorkoutId: string): Record<string, unknown> | null {
  return db.prepare(`
    SELECT *
    FROM future_workouts
    WHERE pacer_workout_id = ?
  `).get(pacerWorkoutId) as Record<string, unknown> | undefined ?? null;
}

function insertFutureWorkoutRevision(
  db: SqliteDatabase,
  workout: FutureWorkoutProposal,
  action: StoredFutureWorkoutRevision['action'],
  recordedAt: string,
): void {
  db.prepare(`
    INSERT INTO future_workout_revisions (pacer_workout_id, proposal_revision, action, proposal_json, recorded_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(workout.pacerWorkoutId, workout.proposalRevision, action, JSON.stringify(workout), recordedAt);
}

/**
 * Imports are proposal-only. Revisions may replace only a still-unapproved,
 * unsynchronized proposal with the same deterministic Pacer identity.
 */
export function importStoredFutureWorkout(workout: FutureWorkoutProposal): FutureWorkoutImportResult {
  const db = getDatabase();
  const operation = db.transaction((): FutureWorkoutImportResult['operation'] => {
    const existingRow = getStoredFutureWorkoutRow(db, workout.pacerWorkoutId);
    const now = new Date().toISOString();
    const identityKey = futureWorkoutIdentityKey(workout);

    if (!existingRow) {
      db.prepare(`
        INSERT INTO future_workouts (
          pacer_workout_id, identity_key, proposal_key, proposal_revision,
          source_activity_id, source_session_date, scheduled_local_date, timezone,
          workout_type, title, coaching_notes, proposal_json,
          approval_status, approved_at, approval_note, sync_status, synced_at,
          intervals_event_id, last_sync_error, created_at, stored_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workout.pacerWorkoutId, identityKey, workout.proposalKey, workout.proposalRevision,
        workout.sourceSession.sourceActivityId, workout.sourceSession.sessionDate, workout.schedule.localDate, workout.schedule.timezone,
        workout.workoutType, workout.title, workout.coachingNotes, JSON.stringify(workout),
        workout.lifecycle.approvalStatus, workout.lifecycle.approvedAt, workout.lifecycle.approvalNote,
        workout.lifecycle.syncStatus, workout.lifecycle.syncedAt, workout.lifecycle.intervalsEventId,
        workout.lifecycle.lastSyncError, now, now,
      );
      insertFutureWorkoutRevision(db, workout, 'imported', now);
      return 'created';
    }

    const existing = parseStoredFutureWorkout(existingRow);
    if (futureWorkoutIdentityKey(existing) !== identityKey) {
      throw new Error('Future workout identity conflict.');
    }
    if (workout.proposalRevision < existing.proposalRevision) {
      throw new Error('Future workout proposal revision is older than the stored proposal.');
    }
    if (workout.proposalRevision === existing.proposalRevision) {
      if (JSON.stringify(workout) !== JSON.stringify(existing)) {
        throw new Error('Future workout proposal conflicts with the stored revision.');
      }
      return 'unchanged';
    }
    if (existing.lifecycle.approvalStatus !== 'proposed' || existing.lifecycle.syncStatus !== 'not_requested') {
      throw new Error('An approved or synchronized future workout cannot be overwritten by import.');
    }

    db.prepare(`
      UPDATE future_workouts
      SET proposal_key = ?, proposal_revision = ?, source_activity_id = ?, source_session_date = ?,
          scheduled_local_date = ?, timezone = ?, workout_type = ?, title = ?, coaching_notes = ?,
          proposal_json = ?, stored_at = ?
      WHERE pacer_workout_id = ?
    `).run(
      workout.proposalKey, workout.proposalRevision, workout.sourceSession.sourceActivityId, workout.sourceSession.sessionDate,
      workout.schedule.localDate, workout.schedule.timezone, workout.workoutType, workout.title, workout.coachingNotes,
      JSON.stringify(workout), now, workout.pacerWorkoutId,
    );
    insertFutureWorkoutRevision(db, workout, 'revised', now);
    return 'revised';
  })();

  const stored = getStoredFutureWorkout(workout.pacerWorkoutId);
  if (!stored) throw new Error(`Could not reload future workout ${workout.pacerWorkoutId}.`);
  return { operation, stored };
}

export function getStoredFutureWorkout(pacerWorkoutId: string): StoredFutureWorkout | null {
  const db = getDatabase();
  const row = getStoredFutureWorkoutRow(db, pacerWorkoutId);
  return row ? mapStoredFutureWorkout(db, row) : null;
}

export function listStoredFutureWorkouts(): StoredFutureWorkout[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT *
    FROM future_workouts
    ORDER BY scheduled_local_date ASC, pacer_workout_id ASC
  `).all() as Record<string, unknown>[];
  return rows.map((row) => mapStoredFutureWorkout(db, row));
}

/** Explicit maintenance-only rename. It never changes identity, content, lifecycle, or history. */
export function renameStoredSyncedFutureWorkout(input: StoredFutureWorkoutRenameInput): { applied: boolean; oldTitle: string; newTitle: string } {
  const db = getDatabase();
  const run = db.transaction(() => {
    const row = getStoredFutureWorkoutRow(db, input.pacerWorkoutId);
    if (!row) throw new Error('Future workout not found.');
    const workout = parseStoredFutureWorkout(row);
    if (workout.proposalKey !== input.proposalKey || workout.title !== input.expectedTitle || String(row.title) !== input.expectedTitle) {
      throw new Error('Future workout title or proposal identity no longer matches the expected value.');
    }
    if (workout.lifecycle.approvalStatus !== 'approved' || workout.lifecycle.syncStatus !== 'synced' || workout.lifecycle.intervalsEventId !== input.expectedIntervalsEventId) {
      throw new Error('Future workout is not the expected approved and synchronized event.');
    }
    if (!input.nextTitle.trim()) throw new Error('Future workout title is required.');
    if (input.dryRun) return { applied: false, oldTitle: workout.title, newTitle: input.nextTitle.trim() };
    // Keep proposal_json byte-for-byte equivalent except for title. Lifecycle is
    // authoritative in columns and must not be normalized as a rename side effect.
    const rawProposal = JSON.parse(String(row.proposal_json)) as FutureWorkoutProposal;
    const renamed = { ...rawProposal, title: input.nextTitle.trim() };
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE future_workouts SET title=?, proposal_json=?, stored_at=?
      WHERE pacer_workout_id=? AND proposal_key=? AND title=?
        AND approval_status='approved' AND sync_status='synced' AND intervals_event_id=?
    `).run(renamed.title, JSON.stringify(renamed), now, input.pacerWorkoutId, input.proposalKey, input.expectedTitle, input.expectedIntervalsEventId);
    if (result.changes !== 1) throw new Error('Future workout changed during rename; no update was applied.');
    return { applied: true, oldTitle: workout.title, newTitle: renamed.title };
  });
  return run();
}

/** Explicit maintenance-only qualitative feedback update. Session core and laps are never touched. */
export function updateStoredSessionFeedback(input: StoredSessionFeedbackUpdateInput): { applied: boolean; oldValue: StoredSessionFeedbackUpdateInput['expected']; newValue: StoredSessionFeedbackUpdateInput['next'] } {
  const db = getDatabase();
  const run = db.transaction(() => {
    const row = db.prepare(`
      SELECT s.id, s.source_activity_id, s.session_date, ai.signal_title, ai.signal_paragraphs_json, ai.carry_forward,
        (SELECT COUNT(*) FROM session_laps WHERE session_id=s.id) AS lap_count
      FROM sessions s JOIN session_ai ai ON ai.session_id=s.id WHERE s.id=?
    `).get(input.sessionId) as Record<string, unknown> | undefined;
    if (!row || Number(row.source_activity_id) !== input.sourceActivityId || String(row.session_date) !== input.sessionDate) {
      throw new Error('Session identity no longer matches the expected session.');
    }
    if (Number(row.lap_count) !== input.expectedLapCount) throw new Error('Session lap count no longer matches the expected value.');
    const oldValue = {
      signalTitle: typeof row.signal_title === 'string' ? row.signal_title : '',
      signalParagraphs: parseJsonArray(row.signal_paragraphs_json),
      carryForward: typeof row.carry_forward === 'string' ? row.carry_forward : '',
    };
    if (JSON.stringify(oldValue) !== JSON.stringify(input.expected)) throw new Error('Qualitative feedback no longer matches the expected current value.');
    const newValue = {
      signalTitle: input.next.signalTitle.trim(),
      signalParagraphs: input.next.signalParagraphs.map((paragraph) => paragraph.trim()).filter(Boolean),
      carryForward: input.next.carryForward.trim(),
    };
    if (!newValue.signalTitle || !newValue.carryForward) throw new Error('Feedback title and carry-forward are required.');
    if (input.dryRun) return { applied: false, oldValue, newValue };
    const result = db.prepare(`
      UPDATE session_ai SET signal_title=?, signal_paragraphs_json=?, carry_forward=?
      WHERE session_id=? AND signal_title=? AND signal_paragraphs_json=? AND carry_forward=?
    `).run(newValue.signalTitle, JSON.stringify(newValue.signalParagraphs), newValue.carryForward, input.sessionId,
      oldValue.signalTitle || null, JSON.stringify(oldValue.signalParagraphs), oldValue.carryForward || null);
    if (result.changes !== 1) throw new Error('Qualitative feedback changed during update; no update was applied.');
    return { applied: true, oldValue, newValue };
  });
  return run();
}

/** Explicit maintenance-only next-run title update. It never changes the workout or session content. */
export function updateStoredSessionNextRunTitle(input: StoredSessionNextRunTitleUpdateInput): { applied: boolean; oldTitle: string; newTitle: string } {
  const db = getDatabase();
  const run = db.transaction(() => {
    const row = db.prepare(`
      SELECT s.id, s.source_activity_id, s.session_date, ai.next_run_title,
        (SELECT COUNT(*) FROM session_laps WHERE session_id=s.id) AS lap_count
      FROM sessions s JOIN session_ai ai ON ai.session_id=s.id WHERE s.id=?
    `).get(input.sessionId) as Record<string, unknown> | undefined;
    if (!row || Number(row.source_activity_id) !== input.sourceActivityId || String(row.session_date) !== input.sessionDate) {
      throw new Error('Session identity no longer matches the expected session.');
    }
    if (Number(row.lap_count) !== input.expectedLapCount) throw new Error('Session lap count no longer matches the expected value.');
    const oldTitle = typeof row.next_run_title === 'string' ? row.next_run_title : '';
    if (oldTitle !== input.expectedNextRunTitle) throw new Error('Next-run title no longer matches the expected current value.');
    const newTitle = input.nextRunTitle.trim();
    if (!newTitle) throw new Error('Next-run title is required.');
    if (input.dryRun) return { applied: false, oldTitle, newTitle };
    const result = db.prepare(`
      UPDATE session_ai SET next_run_title=?
      WHERE session_id=? AND next_run_title=?
    `).run(newTitle, input.sessionId, oldTitle || null);
    if (result.changes !== 1) throw new Error('Next-run title changed during update; no update was applied.');
    return { applied: true, oldTitle, newTitle };
  });
  return run();
}

export function approveStoredFutureWorkout(pacerWorkoutId: string, approvalNote: string | null = null): StoredFutureWorkout {
  const db = getDatabase();
  db.transaction(() => {
    const row = getStoredFutureWorkoutRow(db, pacerWorkoutId);
    if (!row) throw new Error('Future workout not found.');
    if (getStoredFutureWorkoutSkipFromDatabase(db, pacerWorkoutId)) throw new Error('Skipped workouts cannot be approved or synchronized.');
    const existing = parseStoredFutureWorkout(row);
    if (existing.lifecycle.approvalStatus === 'approved') return;
    if (existing.lifecycle.approvalStatus !== 'proposed' || existing.lifecycle.syncStatus !== 'not_requested') {
      throw new Error('Only an unsynchronized proposed future workout can be approved.');
    }

    const approvedAt = new Date().toISOString();
    const approved: FutureWorkoutProposal = {
      ...existing,
      lifecycle: {
        ...existing.lifecycle,
        approvalStatus: 'approved',
        approvedAt,
        approvalNote,
      },
    };
    db.prepare(`
      UPDATE future_workouts
      SET approval_status = 'approved', approved_at = ?, approval_note = ?, proposal_json = ?, stored_at = ?
      WHERE pacer_workout_id = ?
    `).run(approvedAt, approvalNote, JSON.stringify(approved), approvedAt, pacerWorkoutId);
    insertFutureWorkoutRevision(db, approved, 'approved', approvedAt);
  })();

  const stored = getStoredFutureWorkout(pacerWorkoutId);
  if (!stored) throw new Error(`Could not reload future workout ${pacerWorkoutId}.`);
  return stored;
}

export function beginFutureWorkoutSync(pacerWorkoutId: string): StoredFutureWorkout {
  const db = getDatabase();
  db.transaction(() => {
    const row = getStoredFutureWorkoutRow(db, pacerWorkoutId);
    if (!row) throw new Error('Future workout not found.');
    if (getStoredFutureWorkoutSkipFromDatabase(db, pacerWorkoutId)) throw new Error('Skipped workouts cannot be approved or synchronized.');
    if (String(row.approval_status) !== 'approved') throw new Error('Only approved future workouts can synchronize.');
    if (String(row.sync_status) === 'synced') return;
    if (String(row.sync_status) === 'syncing') {
      const attempted = Date.parse(String(row.sync_attempted_at ?? ''));
      if (!Number.isFinite(attempted) || Date.now() - attempted < 60_000) {
        throw new Error('Future workout synchronization is already in progress.');
      }
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE future_workouts SET sync_status='syncing', sync_attempted_at=?, last_sync_error=NULL, stored_at=? WHERE pacer_workout_id=?`).run(now, now, pacerWorkoutId);
    db.prepare(`INSERT INTO future_workout_sync_attempts (pacer_workout_id,status,attempted_at) VALUES (?, 'syncing', ? )`).run(pacerWorkoutId, now);
  })();
  return getStoredFutureWorkout(pacerWorkoutId)!;
}

export function finishFutureWorkoutSync(pacerWorkoutId: string, eventId: string): StoredFutureWorkout {
  const db = getDatabase(); const now = new Date().toISOString();
  db.transaction(() => {
    if (getStoredFutureWorkoutSkipFromDatabase(db, pacerWorkoutId)) throw new Error('Skipped workouts cannot be approved or synchronized.');
    db.prepare(`UPDATE future_workouts SET sync_status='synced', synced_at=?, intervals_event_id=?, last_sync_error=NULL, stored_at=? WHERE pacer_workout_id=? AND approval_status='approved'`).run(now, eventId, now, pacerWorkoutId);
    db.prepare(`INSERT INTO future_workout_sync_attempts (pacer_workout_id,status,remote_event_id,attempted_at) VALUES (?, 'synced', ?, ?)`).run(pacerWorkoutId,eventId,now);
  })(); return getStoredFutureWorkout(pacerWorkoutId)!;
}

export function failFutureWorkoutSync(pacerWorkoutId: string, error: string): StoredFutureWorkout {
  const db=getDatabase(), now=new Date().toISOString();
  db.transaction(() => { db.prepare(`UPDATE future_workouts SET sync_status='failed', last_sync_error=?, stored_at=? WHERE pacer_workout_id=?`).run(error.slice(0,1000),now,pacerWorkoutId); db.prepare(`INSERT INTO future_workout_sync_attempts (pacer_workout_id,status,error,attempted_at) VALUES (?, 'failed', ?, ?)`).run(pacerWorkoutId,error.slice(0,1000),now); })();
  return getStoredFutureWorkout(pacerWorkoutId)!;
}

export function hasConflictingSyncedFutureWorkout(workout: FutureWorkoutProposal): boolean {
  const db=getDatabase(); return Boolean(db.prepare(`SELECT 1 FROM future_workouts WHERE proposal_key=? AND source_activity_id=? AND source_session_date=? AND pacer_workout_id<>? AND sync_status='synced' LIMIT 1`).get(workout.proposalKey,workout.sourceSession.sourceActivityId,workout.sourceSession.sessionDate,workout.pacerWorkoutId));
}
