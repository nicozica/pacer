import * as fs from 'fs';
import * as readline from 'readline';
import { config } from '../config';

const TOKEN_URL = 'https://www.strava.com/oauth/token';

interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in seconds
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Extracts the authorization code from either a full callback URL or a bare code string.
function extractCode(input: string): string {
  try {
    const url = new URL(input);
    const code = url.searchParams.get('code');
    if (code) return code;
  } catch {
    // Not a URL — treat input as the code directly
  }
  return input;
}

export function buildAuthUrl(): string {
  const { stravaClientId, stravaRedirectUri } = config;
  const params = new URLSearchParams({
    client_id: stravaClientId,
    redirect_uri: stravaRedirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:read_all',
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

async function exchangeCode(code: string): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.stravaClientId,
      client_secret: config.stravaClientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_at: data.expires_at as number,
  };
}

export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.stravaClientId,
      client_secret: config.stravaClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_at: data.expires_at as number,
  };
}

export function saveTokens(tokens: TokenSet): void {
  fs.writeFileSync(config.stravaTokensFile, JSON.stringify(tokens, null, 2));
}

export function loadTokens(): TokenSet | null {
  if (!fs.existsSync(config.stravaTokensFile)) return null;
  return JSON.parse(fs.readFileSync(config.stravaTokensFile, 'utf-8')) as TokenSet;
}

// Returns a valid access token, refreshing if necessary.
// Throws an Error with a human-readable message instead of calling process.exit,
// so it is safe to call from both CLI scripts and the web server.
export async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error('No Strava tokens found. Run `npm run strava:auth` first.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (tokens.expires_at > nowSeconds + 60) {
    return tokens.access_token;
  }

  console.log('Access token expired — refreshing...');
  let refreshed: TokenSet;
  try {
    refreshed = await refreshTokens(tokens.refresh_token);
  } catch (err) {
    throw new Error(
      `Failed to refresh Strava token: ${(err as Error).message}. Run \`npm run strava:auth\` to re-authenticate.`
    );
  }

  saveTokens(refreshed);
  console.log('Token refreshed and saved.');
  return refreshed.access_token;
}

// Interactive OAuth flow: prints the auth URL, asks the user to paste the callback.
export async function runAuthFlow(): Promise<void> {
  const { stravaClientId, stravaClientSecret } = config;

  if (!stravaClientId || !stravaClientSecret) {
    console.error('STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set in your .env file.');
    process.exit(1);
  }

  const authUrl = buildAuthUrl();

  console.log('\nOpen this URL in your browser to authorize Pacer:\n');
  console.log(`  ${authUrl}\n`);
  console.log('After authorizing, Strava will redirect you to a URL like:');
  console.log('  http://localhost?state=&code=<code>&scope=...\n');

  const input = await prompt('Paste the full redirect URL or just the code: ');
  const code = extractCode(input);

  if (!code) {
    console.error('No code found in the input. Please try again.');
    process.exit(1);
  }

  console.log('Exchanging code for tokens...');
  const tokens = await exchangeCode(code);
  saveTokens(tokens);

  console.log(`\n✓ Tokens saved to: ${config.stravaTokensFile}`);
  console.log('You can now run `npm run strava:fetch` to download your activities.');
}
