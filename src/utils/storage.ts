import * as fs from 'fs';
import * as path from 'path';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// Returns the full path for a screenshot file.
// Structure: storage/screenshots/YYYY-MM-DD/<url-slug>_HHmmss.png
export function buildScreenshotPath(storageDir: string, url: string): string {
  const now = new Date();
  const dateFolder = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 8).replace(/:/g, ''); // HHmmss

  const slug = url
    .replace(/https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);

  const dir = path.join(storageDir, 'screenshots', dateFolder);
  ensureDir(dir);

  return path.join(dir, `${slug}_${time}.png`);
}
