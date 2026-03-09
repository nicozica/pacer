import * as fs from 'fs';
import * as readline from 'readline';
import { chromium } from 'playwright';
import { SITES, SiteName } from './sites';

function prompt(question: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, () => {
      rl.close();
      resolve();
    });
  });
}

async function run(): Promise<void> {
  const siteName = process.argv[2] as SiteName | undefined;

  if (!siteName || !(siteName in SITES)) {
    const valid = Object.keys(SITES).join(', ');
    console.error(`Usage: npm run auth:<site>   (valid sites: ${valid})`);
    process.exit(1);
  }

  const site = SITES[siteName];

  console.log(`\nSite:      ${siteName}`);
  console.log(`Login URL: ${site.loginUrl}`);
  console.log(`Auth file: ${site.authFile}\n`);

  if (fs.existsSync(site.authFile)) {
    console.warn(`⚠️  Warning: ${site.authFile} already exists and will be overwritten.\n`);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(site.loginUrl);

  await prompt('Log in manually in the browser window, then press Enter here to save the session...');

  await context.storageState({ path: site.authFile });

  await browser.close();

  console.log(`\n✓ Auth state saved: ${site.authFile}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
