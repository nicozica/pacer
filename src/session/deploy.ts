import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';
import { PublishStatus } from './types';

const execFileAsync = promisify(execFile);
const MARKER_PREFIX = 'PACER_PUBLISH_';
const OUTPUT_TAIL_LINES = 18;

function parseMarker(output: string, key: string): string | null {
  const marker = `${MARKER_PREFIX}${key}=`;
  const lines = output.split(/\r?\n/);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? '';
    if (line.startsWith(marker)) {
      return line.slice(marker.length).trim();
    }
  }

  return null;
}

function buildOutputTail(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-OUTPUT_TAIL_LINES);
}

function buildPublishMessage(status: PublishStatus): string {
  if (status.locked) {
    return 'Snapshots exported. Another deploy is already running.';
  }
  if (status.ok && status.originInconclusive) {
    return 'Snapshots exported · Build OK · Deploy OK · Published successfully · Origin verification inconclusive';
  }
  if (status.ok) {
    return 'Snapshots exported · Build OK · Deploy OK · Production verified';
  }
  if (status.timedOut) {
    return 'Snapshots exported · Build/deploy timed out';
  }
  if (status.buildOk && status.deployOk && status.originVerified && !status.publicVerified) {
    return 'Snapshots exported · Build OK · Deploy OK · Origin verified · Still not visible publicly';
  }
  if (status.buildOk && status.deployOk && !status.verifyOk) {
    return 'Snapshots exported · Build OK · Deploy OK · Production verification failed';
  }
  if (status.buildOk && !status.deployOk) {
    return 'Snapshots exported · Build OK · Deploy failed';
  }
  if (!status.buildOk) {
    return 'Snapshots exported · Build failed';
  }
  return 'Snapshots exported · Publish hook failed';
}

function finalizePublishStatus(params: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}): PublishStatus {
  const output = [params.stdout, params.stderr].filter(Boolean).join('\n');
  const buildOk = parseMarker(output, 'BUILD_OK') === '1';
  const deployOk = parseMarker(output, 'DEPLOY_OK') === '1';
  const originVerified = parseMarker(output, 'VERIFY_ORIGIN_OK') === '1';
  const publicVerified = parseMarker(output, 'VERIFY_PUBLIC_OK') === '1';
  const originInconclusive = parseMarker(output, 'ORIGIN_INCONCLUSIVE') === '1'
    || (!originVerified && publicVerified);
  const locked = parseMarker(output, 'LOCKED') === '1' || params.exitCode === 75;
  const logFile = parseMarker(output, 'LOG_FILE');
  const deployTarget = parseMarker(output, 'DEPLOY_TARGET');
  const expectedSessionPath = parseMarker(output, 'EXPECTED_SESSION_PATH');
  const publicUrl = parseMarker(output, 'PUBLIC_URL');
  const publishedSuccessfully = !locked && !params.timedOut && buildOk && deployOk && publicVerified && params.exitCode === 0;
  const fullyVerified = publishedSuccessfully && originVerified;

  const status: PublishStatus = {
    ok: publishedSuccessfully,
    snapshotsOk: true,
    buildOk,
    deployOk,
    verifyOk: fullyVerified,
    originVerified,
    publicVerified,
    originInconclusive,
    timedOut: params.timedOut,
    locked,
    exitCode: params.exitCode,
    signal: params.signal,
    logFile,
    deployTarget,
    expectedSessionPath,
    publicUrl,
    message: '',
    outputTail: buildOutputTail(output),
  };

  status.message = buildPublishMessage(status);
  return status;
}

export async function deployRunSite(): Promise<PublishStatus> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [config.runSiteDeployScript], {
      cwd: process.cwd(),
      env: process.env,
      timeout: config.runSiteDeployTimeoutMs,
      maxBuffer: 1024 * 1024 * 8,
    });

    return finalizePublishStatus({
      stdout,
      stderr,
      exitCode: 0,
      signal: null,
      timedOut: false,
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      code?: number | string;
      signal?: string | null;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    const timedOut = err.code === 'ETIMEDOUT' || err.killed === true;

    return finalizePublishStatus({
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      exitCode: typeof err.code === 'number' ? err.code : null,
      signal: err.signal ?? null,
      timedOut,
    });
  }
}
