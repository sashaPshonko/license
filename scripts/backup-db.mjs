#!/usr/bin/env node
/**
 * Ручной бэкап license.db (консистентный snapshot).
 * Usage: node scripts/backup-db.mjs
 */
import { openDb, runDbBackup, closeDb } from '../src/db.mjs';

const db = openDb();
try {
    const dest = runDbBackup(db);
    console.log('ok', dest);
} finally {
    closeDb(db);
}
