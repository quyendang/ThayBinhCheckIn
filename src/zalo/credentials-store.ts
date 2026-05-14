import { existsSync, readFileSync, writeFileSync } from 'fs';
import { config } from '../config.js';
import { getAdminDb } from '../firebase/admin.js';

// Tách biệt hoàn toàn khỏi data của user (users/{uid}/classrooms/...)
const FB_PATH = 'system/zaloCreds';

export async function backupCredsToFirebase(): Promise<void> {
  const db = getAdminDb();
  if (!db || !existsSync(config.zalo.credentialsPath)) return;
  try {
    const b64 = Buffer.from(readFileSync(config.zalo.credentialsPath, 'utf8')).toString('base64');
    await db.ref(FB_PATH).set(b64);
    console.log('[Zalo] Credentials backed up to Firebase ✓');
  } catch (err) {
    console.error('[Zalo] Firebase backup failed:', err);
  }
}

export async function deleteCredsFromFirebase(): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  try {
    await db.ref(FB_PATH).remove();
    console.log('[Zalo] Credentials deleted from Firebase ✓');
  } catch (err) {
    console.error('[Zalo] Firebase credentials delete failed:', err);
  }
}

export async function restoreCredsFromFirebase(): Promise<boolean> {
  const db = getAdminDb();
  if (!db || existsSync(config.zalo.credentialsPath)) return false;
  try {
    const snap = await db.ref(FB_PATH).get();
    if (!snap.exists()) return false;
    const content = Buffer.from(snap.val() as string, 'base64').toString('utf8');
    writeFileSync(config.zalo.credentialsPath, content, 'utf8');
    console.log('[Boot] Zalo credentials restored from Firebase ✓');
    return true;
  } catch (err) {
    console.error('[Boot] Firebase credentials restore failed:', err);
    return false;
  }
}
