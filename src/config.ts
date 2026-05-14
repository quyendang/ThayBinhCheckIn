import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Root của project (src/../) */
const PROJECT_ROOT = path.resolve(__dirname, '..');

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function resolvePath(envVal: string | undefined, defaultRelative: string): string {
  const raw = envVal ?? defaultRelative;
  // Already absolute → use as-is, otherwise resolve from project root
  return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
}

export const config = {
  server: {
    port: Number(process.env.PORT ?? 3000),
  },
  apiKey: requireEnv('API_KEY'),
  zalo: {
    credentialsPath: resolvePath(process.env.ZALO_CREDENTIALS_PATH, 'credentials.json'),
  },
  firebase: {
    apiKey:      process.env.FIREBASE_API_KEY      ?? '',
    authDomain:  process.env.FIREBASE_AUTH_DOMAIN  ?? '',
    databaseURL: process.env.FIREBASE_DATABASE_URL ?? '',
  },
} as const;
