import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = join(__dirname, '..', 'data', 'license.db');

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 90_000;
const HEARTBEAT_HINT_MS = Number(process.env.HEARTBEAT_MS) || 30_000;

export function openDb(dbPath = process.env.LICENSE_DB || DEFAULT_DB) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS license_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_code TEXT NOT NULL UNIQUE,
            plan TEXT NOT NULL CHECK(plan IN ('normal', 'pro', 'admin')),
            created_at TEXT NOT NULL,
            expires_at TEXT,
            revoked INTEGER NOT NULL DEFAULT 0,
            note TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            key_id INTEGER NOT NULL REFERENCES license_keys(id) ON DELETE CASCADE,
            device_id TEXT,
            app_version TEXT,
            started_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            ended_at TEXT,
            end_reason TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_key_active
            ON sessions(key_id) WHERE ended_at IS NULL;

        CREATE TABLE IF NOT EXISTS launches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_id INTEGER NOT NULL REFERENCES license_keys(id) ON DELETE CASCADE,
            session_id TEXT,
            device_id TEXT,
            app_version TEXT,
            at TEXT NOT NULL,
            ok INTEGER NOT NULL,
            reason TEXT
        );

        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_id INTEGER NOT NULL REFERENCES license_keys(id) ON DELETE CASCADE,
            session_id TEXT,
            side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
            price INTEGER NOT NULL,
            label TEXT NOT NULL,
            item_type TEXT NOT NULL DEFAULT '',
            enchants_json TEXT NOT NULL DEFAULT '[]',
            integrity REAL,
            anarchy INTEGER,
            profit INTEGER,
            ts TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_trades_key_ts ON trades(key_id, ts);
        CREATE INDEX IF NOT EXISTS idx_trades_label ON trades(label);
        CREATE INDEX IF NOT EXISTS idx_trades_type ON trades(item_type);
    `);
    // миграция: старые БД без item_type
    try {
        const cols = db.prepare(`PRAGMA table_info(trades)`).all();
        if (!cols.some((c) => c.name === 'item_type')) {
            db.exec(`ALTER TABLE trades ADD COLUMN item_type TEXT NOT NULL DEFAULT ''`);
        }
    } catch {
        /* ignore */
    }
    return db;
}

export function generateKeyCode() {
    const part = () => randomBytes(3).toString('hex').toUpperCase();
    return `POP-${part()}-${part()}-${part()}`;
}

export function nowIso() {
    return new Date().toISOString();
}

export function addDaysIso(days) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + Number(days));
    return d.toISOString();
}

export function isKeyActive(row) {
    if (!row || row.revoked) return false;
    if (row.plan === 'admin') return true;
    if (!row.expires_at) return false;
    return new Date(row.expires_at).getTime() > Date.now();
}

/** Сколько Minecraft-ботов можно гонять в одном приложении. */
export function maxBotsForPlan(plan) {
    if (plan === 'admin') return 100;
    if (plan === 'pro') return 20;
    return 1; // normal
}

/** Закрыть протухшие сессии (нет heartbeat). */
export function reapStaleSessions(db) {
    const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
    db.prepare(
        `UPDATE sessions
         SET ended_at = ?, end_reason = 'ttl'
         WHERE ended_at IS NULL AND last_seen_at < ?`,
    ).run(nowIso(), cutoff);
}

export function getKeyByCode(db, keyCode) {
    return db
        .prepare(`SELECT * FROM license_keys WHERE key_code = ?`)
        .get(String(keyCode || '').trim());
}

export function countActiveSessions(db, keyId) {
    reapStaleSessions(db);
    return db
        .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE key_id = ? AND ended_at IS NULL`)
        .get(keyId).n;
}

export function createKey(db, { plan, days, note } = {}) {
    const p = plan === 'pro' || plan === 'admin' ? plan : 'normal';
    const keyCode = generateKeyCode();
    const createdAt = nowIso();
    let expiresAt = null;
    if (p !== 'admin') {
        const d = Number(days);
        if (!Number.isFinite(d) || d <= 0) {
            throw new Error('days > 0 required for normal/pro');
        }
        expiresAt = addDaysIso(d);
    }
    db.prepare(
        `INSERT INTO license_keys (key_code, plan, created_at, expires_at, note)
         VALUES (?, ?, ?, ?, ?)`,
    ).run(keyCode, p, createdAt, expiresAt, note || null);
    return getKeyByCode(db, keyCode);
}

export function listKeys(db) {
    reapStaleSessions(db);
    return db
        .prepare(
            `SELECT k.*,
                (SELECT COUNT(*) FROM sessions s WHERE s.key_id = k.id AND s.ended_at IS NULL) AS active_sessions,
                (SELECT COUNT(*) FROM launches l WHERE l.key_id = k.id) AS launch_count,
                (SELECT COUNT(*) FROM trades t WHERE t.key_id = k.id) AS trade_count,
                (SELECT COALESCE(SUM(CASE WHEN t.side='sell' THEN t.price ELSE -t.price END), 0)
                   FROM trades t WHERE t.key_id = k.id) AS net_profit
             FROM license_keys k
             ORDER BY k.id DESC`,
        )
        .all();
}

export function startSession(db, { keyCode, deviceId, appVersion }) {
    reapStaleSessions(db);
    const key = getKeyByCode(db, keyCode);
    const at = nowIso();

    const fail = (reason) => {
        if (key) {
            db.prepare(
                `INSERT INTO launches (key_id, session_id, device_id, app_version, at, ok, reason)
                 VALUES (?, NULL, ?, ?, ?, 0, ?)`,
            ).run(key.id, deviceId || null, appVersion || null, at, reason);
        }
        return { ok: false, reason };
    };

    if (!key) return fail('invalid_key');
    if (key.revoked) return fail('revoked');
    if (!isKeyActive(key)) return fail('expired');

    const active = countActiveSessions(db, key.id);
    if (key.plan !== 'admin' && active >= 1) {
        return fail('already_running');
    }

    const sessionId = randomBytes(16).toString('hex');
    db.prepare(
        `INSERT INTO sessions (id, key_id, device_id, app_version, started_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(sessionId, key.id, deviceId || null, appVersion || null, at, at);

    db.prepare(
        `INSERT INTO launches (key_id, session_id, device_id, app_version, at, ok, reason)
         VALUES (?, ?, ?, ?, ?, 1, NULL)`,
    ).run(key.id, sessionId, deviceId || null, appVersion || null, at);

    return {
        ok: true,
        sessionId,
        plan: key.plan,
        maxBots: maxBotsForPlan(key.plan),
        expiresAt: key.expires_at,
        heartbeatMs: HEARTBEAT_HINT_MS,
        sessionTtlMs: SESSION_TTL_MS,
    };
}

export function heartbeatSession(db, sessionId) {
    reapStaleSessions(db);
    const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    if (!row || row.ended_at) return { ok: false, reason: 'no_session' };
    const key = db.prepare(`SELECT * FROM license_keys WHERE id = ?`).get(row.key_id);
    if (!isKeyActive(key)) {
        db.prepare(
            `UPDATE sessions SET ended_at = ?, end_reason = 'expired' WHERE id = ?`,
        ).run(nowIso(), sessionId);
        return { ok: false, reason: 'expired' };
    }
    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(nowIso(), sessionId);
    return { ok: true, expiresAt: key.expires_at, plan: key.plan };
}

export function stopSession(db, sessionId, reason = 'stop') {
    const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    if (!row) return { ok: false, reason: 'no_session' };
    if (row.ended_at) return { ok: true, already: true };
    db.prepare(
        `UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ?`,
    ).run(nowIso(), reason || 'stop', sessionId);
    return { ok: true };
}

export function insertTrades(db, { sessionId, trades }) {
    const sess = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    if (!sess) return { ok: false, reason: 'no_session' };
    const key = db.prepare(`SELECT * FROM license_keys WHERE id = ?`).get(sess.key_id);
    if (!isKeyActive(key) && key?.plan !== 'admin') {
        // сессия могла быть жива при offline grace — всё равно пишем, если сессия есть
    }

    const stmt = db.prepare(
        `INSERT INTO trades (key_id, session_id, side, price, label, item_type, enchants_json, integrity, anarchy, profit, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let n = 0;
    db.exec('BEGIN');
    try {
        for (const t of Array.isArray(trades) ? trades : []) {
            const side = t.side === 'sell' ? 'sell' : 'buy';
            const price = Math.round(Number(t.price) || 0);
            const label = String(t.label || 'Предмет').slice(0, 120);
            const itemType = String(t.type || t.item_type || t.itemType || '').slice(0, 80);
            const enchants = Array.isArray(t.enchants) ? t.enchants : [];
            const integrity =
                t.integrity == null || t.integrity === ''
                    ? null
                    : Number(t.integrity);
            const anarchy =
                t.anarchy == null || t.anarchy === '' ? null : Number(t.anarchy);
            const profit =
                t.profit == null || t.profit === ''
                    ? side === 'sell'
                        ? price
                        : -price
                    : Math.round(Number(t.profit));
            const ts = t.ts || nowIso();
            stmt.run(
                sess.key_id,
                sessionId,
                side,
                price,
                label,
                itemType,
                JSON.stringify(enchants),
                Number.isFinite(integrity) ? integrity : null,
                Number.isFinite(anarchy) ? anarchy : null,
                profit,
                ts,
            );
            n += 1;
        }
        db.exec('COMMIT');
    } catch (e) {
        try {
            db.exec('ROLLBACK');
        } catch {
            /* ignore */
        }
        throw e;
    }
    return { ok: true, inserted: n };
}

export function profitSummary(db, { keyId, days } = {}) {
    const since =
        days && Number(days) > 0
            ? new Date(Date.now() - Number(days) * 86400000).toISOString()
            : null;

    const byKey = db
        .prepare(
            `SELECT k.key_code, k.plan,
                COUNT(t.id) AS trades,
                COALESCE(SUM(CASE WHEN t.side='sell' THEN t.price ELSE 0 END), 0) AS sold,
                COALESCE(SUM(CASE WHEN t.side='buy' THEN t.price ELSE 0 END), 0) AS bought,
                COALESCE(SUM(CASE WHEN t.side='sell' THEN t.price ELSE -t.price END), 0) AS net
             FROM license_keys k
             LEFT JOIN trades t ON t.key_id = k.id
               AND (? IS NULL OR t.ts >= ?)
             WHERE (? IS NULL OR k.id = ?)
             GROUP BY k.id
             ORDER BY net DESC`,
        )
        .all(since, since, keyId ?? null, keyId ?? null);

    const byDay = db
        .prepare(
            `SELECT substr(ts, 1, 10) AS day,
                COUNT(*) AS trades,
                COALESCE(SUM(CASE WHEN side='sell' THEN price ELSE 0 END), 0) AS sold,
                COALESCE(SUM(CASE WHEN side='buy' THEN price ELSE 0 END), 0) AS bought,
                COALESCE(SUM(CASE WHEN side='sell' THEN price ELSE -price END), 0) AS net
             FROM trades
             WHERE (? IS NULL OR key_id = ?)
               AND (? IS NULL OR ts >= ?)
             GROUP BY day
             ORDER BY day DESC
             LIMIT 90`,
        )
        .all(keyId ?? null, keyId ?? null, since, since);

    const byLabel = db
        .prepare(
            `SELECT label,
                COUNT(*) AS trades,
                SUM(CASE WHEN side='buy' THEN 1 ELSE 0 END) AS buys,
                SUM(CASE WHEN side='sell' THEN 1 ELSE 0 END) AS sells,
                COALESCE(SUM(CASE WHEN side='sell' THEN price ELSE 0 END), 0) AS sold,
                COALESCE(SUM(CASE WHEN side='buy' THEN price ELSE 0 END), 0) AS bought,
                COALESCE(SUM(CASE WHEN side='sell' THEN price ELSE -price END), 0) AS net
             FROM trades
             WHERE (? IS NULL OR key_id = ?)
               AND (? IS NULL OR ts >= ?)
             GROUP BY label
             ORDER BY net DESC
             LIMIT 100`,
        )
        .all(keyId ?? null, keyId ?? null, since, since);

    const byType = db
        .prepare(
            `SELECT COALESCE(NULLIF(item_type, ''), label) AS type,
                COUNT(*) AS trades,
                SUM(CASE WHEN side='buy' THEN 1 ELSE 0 END) AS buys,
                SUM(CASE WHEN side='sell' THEN 1 ELSE 0 END) AS sells,
                COALESCE(SUM(CASE WHEN side='sell' THEN price ELSE 0 END), 0) AS sold,
                COALESCE(SUM(CASE WHEN side='buy' THEN price ELSE 0 END), 0) AS bought,
                COALESCE(SUM(CASE WHEN side='sell' THEN price ELSE -price END), 0) AS net
             FROM trades
             WHERE (? IS NULL OR key_id = ?)
               AND (? IS NULL OR ts >= ?)
             GROUP BY type
             ORDER BY net DESC
             LIMIT 100`,
        )
        .all(keyId ?? null, keyId ?? null, since, since);

    return { byKey, byDay, byLabel, byType };
}

export function listTrades(db, { keyId, limit = 200 } = {}) {
    return db
        .prepare(
            `SELECT t.*, k.key_code
             FROM trades t
             JOIN license_keys k ON k.id = t.key_id
             WHERE (? IS NULL OR t.key_id = ?)
             ORDER BY t.id DESC
             LIMIT ?`,
        )
        .all(keyId ?? null, keyId ?? null, Math.min(Number(limit) || 200, 1000));
}

export function listLaunches(db, { keyId, limit = 100 } = {}) {
    return db
        .prepare(
            `SELECT l.*, k.key_code
             FROM launches l
             JOIN license_keys k ON k.id = l.key_id
             WHERE (? IS NULL OR l.key_id = ?)
             ORDER BY l.id DESC
             LIMIT ?`,
        )
        .all(keyId ?? null, keyId ?? null, Math.min(Number(limit) || 100, 500));
}

export { SESSION_TTL_MS, HEARTBEAT_HINT_MS };
