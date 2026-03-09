import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  headless: process.env.HEADLESS !== 'false',
  storageDir: process.env.STORAGE_DIR ?? 'storage',
  authStateFile: process.env.AUTH_STATE_FILE ?? 'storage/auth/state.json',
  targetPages: (process.env.TARGET_PAGES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
