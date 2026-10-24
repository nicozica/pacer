import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getLatestSessionPublishAttempt, initSessionStore, recordSessionPublishAttempt } from './storage';

// Requires a throwaway DATABASE_FILE; records only to that database.
initSessionStore();
const db = new Database(process.env.DATABASE_FILE as string);
const now = new Date().toISOString();
const id = Number(db.prepare("INSERT INTO sessions (session_date, title, sport, source, source_activity_id, created_at, updated_at) VALUES ('2026-10-18','t','Run','test',1,?,?)").run(now, now).lastInsertRowid);
db.close();
assert.equal(getLatestSessionPublishAttempt(id), null);
recordSessionPublishAttempt(id, false, 'Build failed');
assert.deepEqual(getLatestSessionPublishAttempt(id)?.ok, false);
recordSessionPublishAttempt(id, true, 'Production verified');
assert.equal(getLatestSessionPublishAttempt(id)?.ok, true, 'latest attempt wins');
console.log('Session publish attempt regression checks passed.');
