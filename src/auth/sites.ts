// Add new sites here as needed.
// loginUrl: the page to open so the user can authenticate manually.
// authFile: where the Playwright storage state will be saved.
export const SITES = {
  strava: {
    loginUrl: 'https://www.strava.com/login',
    authFile: 'storage/auth/strava.json',
  },
  garmin: {
    loginUrl: 'https://connect.garmin.com',
    authFile: 'storage/auth/garmin.json',
  },
} as const;

export type SiteName = keyof typeof SITES;
