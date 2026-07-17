import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import {
    openDb,
    createKey,
    listKeys,
    startSession,
    heartbeatSession,
    stopSession,
    insertTrades,
    profitSummary,
    listTrades,
    listLaunches,
    getKeyByCode,
    nowIso,
} from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
/** Если задан — админ API требует заголовок X-Admin-Token или ?token= */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const db = openDb();

// Первый запуск: admin-ключ для тестов, если ещё нет ни одного
const existing = db.prepare(`SELECT COUNT(*) AS n FROM license_keys`).get().n;
if (existing === 0) {
    const admin = createKey(db, { plan: 'admin', note: 'bootstrap admin' });
    console.log(`[license] bootstrap admin key: ${admin.key_code}`);
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
    const raw = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(raw);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (e) {
                reject(new Error('invalid json'));
            }
        });
        req.on('error', reject);
    });
}

function requireAdmin(req, url) {
    if (!ADMIN_TOKEN) return true;
    const header = req.headers['x-admin-token'] || '';
    const q = url.searchParams.get('token') || '';
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return header === ADMIN_TOKEN || q === ADMIN_TOKEN || bearer === ADMIN_TOKEN;
}

async function handleApi(req, res, url) {
    if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
    }

    const path = url.pathname;

    // --- bot API ---
    if (path === '/v1/session/start' && req.method === 'POST') {
        const body = await readBody(req);
        const result = startSession(db, {
            keyCode: body.key,
            deviceId: body.deviceId,
            appVersion: body.appVersion,
        });
        sendJson(res, result.ok ? 200 : 403, result);
        return;
    }

    if (path === '/v1/session/heartbeat' && req.method === 'POST') {
        const body = await readBody(req);
        const result = heartbeatSession(db, body.sessionId);
        sendJson(res, result.ok ? 200 : 403, result);
        return;
    }

    if (path === '/v1/session/stop' && req.method === 'POST') {
        const body = await readBody(req);
        const result = stopSession(db, body.sessionId, body.reason || 'stop');
        sendJson(res, 200, result);
        return;
    }

    if (path === '/v1/events/trades' && req.method === 'POST') {
        const body = await readBody(req);
        const result = insertTrades(db, {
            sessionId: body.sessionId,
            trades: body.trades,
        });
        sendJson(res, result.ok ? 200 : 403, result);
        return;
    }

    if (path === '/v1/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, at: nowIso() });
        return;
    }

    // --- admin API ---
    if (path.startsWith('/v1/admin/')) {
        if (!requireAdmin(req, url)) {
            sendJson(res, 401, { ok: false, reason: 'unauthorized' });
            return;
        }

        if (path === '/v1/admin/keys' && req.method === 'GET') {
            sendJson(res, 200, { ok: true, keys: listKeys(db) });
            return;
        }

        if (path === '/v1/admin/keys' && req.method === 'POST') {
            const body = await readBody(req);
            try {
                const key = createKey(db, {
                    plan: body.plan,
                    days: body.days,
                    note: body.note,
                });
                sendJson(res, 200, { ok: true, key });
            } catch (e) {
                sendJson(res, 400, { ok: false, reason: e.message });
            }
            return;
        }

        if (path === '/v1/admin/keys/revoke' && req.method === 'POST') {
            const body = await readBody(req);
            const key = getKeyByCode(db, body.key);
            if (!key) {
                sendJson(res, 404, { ok: false, reason: 'not_found' });
                return;
            }
            db.prepare(`UPDATE license_keys SET revoked = 1 WHERE id = ?`).run(key.id);
            db.prepare(
                `UPDATE sessions SET ended_at = ?, end_reason = 'revoked'
                 WHERE key_id = ? AND ended_at IS NULL`,
            ).run(nowIso(), key.id);
            sendJson(res, 200, { ok: true });
            return;
        }

        if (path === '/v1/admin/profit' && req.method === 'GET') {
            const keyId = url.searchParams.get('keyId');
            const days = url.searchParams.get('days');
            sendJson(res, 200, {
                ok: true,
                ...profitSummary(db, {
                    keyId: keyId ? Number(keyId) : null,
                    days: days ? Number(days) : null,
                }),
            });
            return;
        }

        if (path === '/v1/admin/trades' && req.method === 'GET') {
            const keyId = url.searchParams.get('keyId');
            const limit = url.searchParams.get('limit');
            sendJson(res, 200, {
                ok: true,
                trades: listTrades(db, {
                    keyId: keyId ? Number(keyId) : null,
                    limit: limit ? Number(limit) : 200,
                }),
            });
            return;
        }

        if (path === '/v1/admin/launches' && req.method === 'GET') {
            const keyId = url.searchParams.get('keyId');
            sendJson(res, 200, {
                ok: true,
                launches: listLaunches(db, {
                    keyId: keyId ? Number(keyId) : null,
                }),
            });
            return;
        }
    }

    sendJson(res, 404, { ok: false, reason: 'not_found' });
}

function serveStatic(req, res, url) {
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    rel = rel.replace(/\.\./g, '');
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !existsSync(file)) {
        res.writeHead(404);
        res.end('not found');
        return;
    }
    const ext = extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        if (url.pathname.startsWith('/v1/')) {
            await handleApi(req, res, url);
            return;
        }
        serveStatic(req, res, url);
    } catch (e) {
        sendJson(res, 500, { ok: false, reason: e.message || 'error' });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`[license] botpodpopcorn listening http://${HOST}:${PORT}`);
    if (ADMIN_TOKEN) console.log('[license] ADMIN_TOKEN required for /v1/admin/*');
    else console.log('[license] admin API open (set ADMIN_TOKEN to lock)');
});
