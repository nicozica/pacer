import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';

function proposal(revision = 1): Record<string, unknown> {
  return {
    contractVersion: 'future-workout-v1',
    proposalKey: 'long-run-steady-finish',
    proposalRevision: revision,
    proposedAt: '2026-10-18T12:00:00.000Z',
    updatedAt: `2026-10-18T12:0${revision}:00.000Z`,
    sourceSession: { sourceActivityId: 198651687, sessionDate: '2026-10-18' },
    schedule: { localDate: '2026-10-25', timezone: 'America/Argentina/Buenos_Aires' },
    workoutType: 'Long Run',
    title: 'Long Run + Steady Finish',
    coachingNotes: 'Start calm; finish steady only if the legs cooperate.',
    blocks: [
      { kind: 'warmup', duration: { unit: 'time', seconds: 900 }, target: { kind: 'unrestricted' } },
      { kind: 'work', duration: { unit: 'time', seconds: 3600 }, target: { kind: 'unrestricted' } },
      { kind: 'work', duration: { unit: 'time', seconds: 1200 }, target: { kind: 'pace', minSecPerKm: 300, maxSecPerKm: 315 } },
      { kind: 'cooldown', duration: { unit: 'time', seconds: 600 }, target: { kind: 'unrestricted' } },
    ],
    lifecycle: {
      approvalStatus: 'proposed', approvedAt: null, approvalNote: null,
      syncStatus: 'not_requested', syncedAt: null, intervalsEventId: null, lastSyncError: null,
    },
  };
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not reserve a TCP port.'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function startServer(port: number, tempDir: string): ChildProcess {
  return spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/web/server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STORAGE_DIR: path.join(tempDir, 'storage'),
      DATABASE_FILE: path.join(tempDir, 'storage', 'db', 'pacer.sqlite'),
      CMS_EXPORT_DIR: path.join(tempDir, 'storage', 'json', 'cms'),
      WEB_HOST: '127.0.0.1',
      WEB_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Temporary Pacer API server did not become healthy.');
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGINT');
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

async function request(port: number, method: string, pathname: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-future-workout-api-'));
  const port = await reservePort();
  let child = startServer(port, tempDir);
  const childErrors: Buffer[] = [];
  child.stderr?.on('data', (chunk) => childErrors.push(Buffer.from(chunk)));

  try {
    await waitForHealth(port);
    const invalid = await request(port, 'POST', '/api/workouts/import', '{');
    assert.equal(invalid.status, 400);

    const created = await request(port, 'POST', '/api/workouts/import', proposal());
    assert.equal(created.status, 201);
    assert.equal(created.body.operation, 'created');
    const createdProposal = created.body.proposal as { workout?: { pacerWorkoutId?: string }; preview?: string[] };
    const id = createdProposal.workout?.pacerWorkoutId;
    assert.match(id ?? '', /^pacer-fw1-/);
    assert.match(createdProposal.preview?.join('\n') ?? '', /Long Run \+ Steady Finish/);

    const duplicate = await request(port, 'POST', '/api/workouts/import', proposal());
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.operation, 'unchanged');

    const conflict = await request(port, 'POST', '/api/workouts/import', { ...proposal(), title: 'Conflicting title' });
    assert.equal(conflict.status, 409);

    const revised = await request(port, 'POST', '/api/workouts/import', proposal(2));
    assert.equal(revised.status, 200);
    assert.equal(revised.body.operation, 'revised');

    const older = await request(port, 'POST', '/api/workouts/import', proposal(1));
    assert.equal(older.status, 409);

    const fetched = await request(port, 'GET', `/api/workouts/${encodeURIComponent(id ?? '')}`);
    assert.equal(fetched.status, 200);
    const fetchedProposal = fetched.body.proposal as { revisions?: unknown[]; workout?: { proposalRevision?: number } };
    assert.equal(fetchedProposal.workout?.proposalRevision, 2);
    assert.equal(fetchedProposal.revisions?.length, 2);

    const approved = await request(port, 'POST', `/api/workouts/${encodeURIComponent(id ?? '')}/approve`, { approvalNote: 'Reviewed locally.' });
    assert.equal(approved.status, 200);
    const approvedProposal = approved.body.proposal as { workout?: { lifecycle?: { approvalStatus?: string } } };
    assert.equal(approvedProposal.workout?.lifecycle?.approvalStatus, 'approved');

    const duplicateApproval = await request(port, 'POST', `/api/workouts/${encodeURIComponent(id ?? '')}/approve`, {});
    assert.equal(duplicateApproval.status, 200, 'approval is idempotent');
    const blockedRevision = await request(port, 'POST', '/api/workouts/import', proposal(3));
    assert.equal(blockedRevision.status, 409);

    await stopServer(child);
    child = startServer(port, tempDir);
    child.stderr?.on('data', (chunk) => childErrors.push(Buffer.from(chunk)));
    await waitForHealth(port);
    const afterRestart = await request(port, 'GET', '/api/workouts');
    assert.equal(afterRestart.status, 200);
    const proposals = afterRestart.body.proposals as Array<{ workout?: { pacerWorkoutId?: string; lifecycle?: { approvalStatus?: string } }; revisions?: unknown[] }>;
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].workout?.pacerWorkoutId, id);
    assert.equal(proposals[0].workout?.lifecycle?.approvalStatus, 'approved');
    assert.equal(proposals[0].revisions?.length, 3);

    await stopServer(child);
    const db = new Database(path.join(tempDir, 'storage', 'db', 'pacer.sqlite'), { readonly: true });
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count, 0,
      'workout imports must not save source sessions');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM future_workouts').get() as { count: number }).count, 1);
    db.close();
  } catch (error) {
    await stopServer(child);
    const diagnostic = Buffer.concat(childErrors).toString('utf8').trim();
    if (diagnostic) console.error(diagnostic);
    throw error;
  }

  console.log('Future workout API persistence regression checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
