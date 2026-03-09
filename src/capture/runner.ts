import * as fs from 'fs';
import { chromium, BrowserContextOptions } from 'playwright';
import { config } from '../config';
import { buildScreenshotPath } from '../utils/storage';

async function run(): Promise<void> {
  if (config.targetPages.length === 0) {
    console.error('No TARGET_PAGES configured. Add them to your .env file.');
    process.exit(1);
  }

  const contextOptions: BrowserContextOptions = {};

  if (fs.existsSync(config.authStateFile)) {
    console.log(`Auth state found: ${config.authStateFile}`);
    contextOptions.storageState = config.authStateFile;
  }

  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  for (const url of config.targetPages) {
    console.log(`Capturing: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle' });

    const filePath = buildScreenshotPath(config.storageDir, url);
    await page.screenshot({ path: filePath, fullPage: true });

    console.log(`  → ${filePath}`);
  }

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
