import { getAccessToken } from './auth';

const API_BASE = 'https://www.strava.com/api/v3';

// Thin wrapper around the Strava API. Uses Node's built-in fetch (Node 18+).
export async function stravaGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const accessToken = await getAccessToken();

  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Strava API error on ${path} (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}
