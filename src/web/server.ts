import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { buildSummary } from './summary';
import { fetchAndSaveActivities } from '../strava/activities';

const WEB_DIR = path.resolve(process.cwd(), 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const mime = MIME[ext] ?? 'text/plain';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
}

// Translates a known error message into a user-friendly string.
function friendlyError(err: Error): string {
  const msg = err.message ?? '';
  if (msg.includes('No Strava tokens')) {
    return 'No Strava tokens found. Run `npm run strava:auth` first.';
  }
  if (msg.includes('re-authenticate') || msg.includes('401') || msg.includes('403')) {
    return 'Strava authentication failed. Run `npm run strava:auth` to re-authenticate.';
  }
  if (msg.includes('429')) {
    return 'Strava API rate limit reached. Wait a few minutes and try again.';
  }
  if (msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
    return 'Network error. Check your internet connection and try again.';
  }
  return `Refresh failed: ${msg}`;
}

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const method = req.method ?? 'GET';

  if (url === '/api/latest' && method === 'GET') {
    try {
      sendJson(res, 200, buildSummary());
    } catch (err) {
      sendJson(res, 500, { error: 'Could not read activity data. Try running `npm run strava:fetch` first.' });
    }
    return;
  }

  if (url === '/api/refresh' && method === 'POST') {
    try {
      await fetchAndSaveActivities();
      sendJson(res, 200, buildSummary());
    } catch (err) {
      sendJson(res, 500, { error: friendlyError(err as Error) });
    }
    return;
  }

  // Static file serving — resolve against WEB_DIR, prevent path traversal
  const rel = url === '/' ? 'index.html' : url.replace(/^\//, '');
  const filePath = path.resolve(WEB_DIR, rel);
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  serveFile(res, filePath);
});

const { webHost, webPort } = config;
server.listen(webPort, webHost, () => {
  console.log(`\nPacer running at http://${webHost}:${webPort}\n`);
});
