#!/usr/bin/env node
/** Показать или создать admin-ключ для входа в админку. */
import { openDb, createKey } from '../src/db.mjs';

const db = openDb();
let row = db
    .prepare(
        `SELECT key_code, note, created_at FROM license_keys
         WHERE plan = 'admin' AND revoked = 0
         ORDER BY id ASC LIMIT 1`,
    )
    .get();

if (!row) {
    row = createKey(db, { plan: 'admin', note: 'ensure-admin' });
    console.log('создан новый admin-ключ:');
} else {
    console.log('admin-ключ:');
}
console.log(row.key_code);
console.log('(вставь его на http://IP:8787/ — plan=normal/pro туда не подойдут)');
