import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase, type Database } from 'firebase-admin/database';
import { config } from '../config.js';

let _db: Database | null = null;
let _initialized = false;

export function getAdminDb(): Database | null {
  if (_initialized) return _db;
  _initialized = true;

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!b64 || !config.firebase.databaseURL) return null;

  try {
    const serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const app = getApps().length === 0
      ? initializeApp({ credential: cert(serviceAccount), databaseURL: config.firebase.databaseURL })
      : getApps()[0]!;
    _db = getDatabase(app);
    console.log('[Firebase Admin] Initialized ✓');
  } catch (err) {
    console.error('[Firebase Admin] Init failed:', err);
    _db = null;
  }

  return _db;
}
