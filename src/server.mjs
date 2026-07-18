import { createServer } from 'http';
import { readFileSync, existsSync, createReadStream } from 'fs';
import { join, dirname, extname, basename } from 'path';
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
    itemLeaderboard,
    buildAnalysisPack,
    analysisToMarkdown,
    getDbPath,
    isAdminAuth,
} from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
/** Опциональный env-токен. Основной вход — admin license key. */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const db = openDb();

function ensureAdminKeyLogged() {
    let admin = db
        .prepare(
            `SELECT key_code FROM license_keys
             WHERE plan = 'admin' AND revoked = 0
             ORDER BY id ASC LIMIT 1`,
        )
        .get();
    if (!admin) {
        admin = createKey(db, { plan: 'admin', note: 'bootstrap admin' });
        console.log(`[license] created admin key: ${admin.key_code}`);
    } else {
        console.log(`[license] admin key: ${admin.key_code}`);
    }
    return admin.key_code;
}

ensureAdminKeyLogged();

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.db': 'application/octet-stream',
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

function sendDownload(res, { status = 200, filename, contentType, body }) {
    res.writeHead(status, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(body);
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

function extractAdminToken(req, url) {
    const header = String(req.headers['x-admin-token'] || '').trim();
    const q = String(url.searchParams.get('token') || '').trim();
    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    return header || q || bearer || '';
}

function requireAdmin(req, url) {
    return isAdminAuth(db, extractAdminToken(req, url), ADMIN_TOKEN);
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
        // Логин по admin-ключу (без предварительного токена)
        if (path === '/v1/admin/login' && req.method === 'POST') {
            const body = await readBody(req);
            const keyCode = String(body.key || body.token || '').trim();
            if (!keyCode) {
                sendJson(res, 400, { ok: false, reason: 'no_key' });
                return;
            }
            const key = getKeyByCode(db, keyCode);
            if (!isAdminAuth(db, keyCode, ADMIN_TOKEN)) {
                sendJson(res, 401, {
                    ok: false,
                    reason: 'unauthorized',
                    hint:
                        key && key.plan !== 'admin'
                            ? `это ключ plan=${key.plan}, нужен plan=admin`
                            : 'ключ не найден или не admin',
                });
                return;
            }
            sendJson(res, 200, {
                ok: true,
                plan: key?.plan || 'admin',
                note: key?.note || null,
            });
            return;
        }

        if (path === '/v1/admin/me' && req.method === 'GET') {
            if (!requireAdmin(req, url)) {
                sendJson(res, 401, { ok: false, reason: 'unauthorized' });
                return;
            }
            const tok = extractAdminToken(req, url);
            const key = getKeyByCode(db, tok);
            sendJson(res, 200, {
                ok: true,
                plan: key?.plan || (ADMIN_TOKEN && tok === ADMIN_TOKEN ? 'env' : 'admin'),
            });
            return;
        }

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

        if (path === '/v1/admin/items' && req.method === 'GET') {
            const days = url.searchParams.get('days');
            sendJson(res, 200, {
                ok: true,
                ...itemLeaderboard(db, {
                    days: days ? Number(days) : 30,
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

        if (path === '/v1/admin/export/analysis.json' && req.method === 'GET') {
            const days = Number(url.searchParams.get('days')) || 30;
            const pack = buildAnalysisPack(db, { days });
            sendDownload(res, {
                filename: `botpodpopcorn-analysis-${days}d.json`,
                contentType: 'application/json; charset=utf-8',
                body: JSON.stringify(pack, null, 2),
            });
            return;
        }

        if (path === '/v1/admin/export/analysis.md' && req.method === 'GET') {
            const days = Number(url.searchParams.get('days')) || 30;
            const pack = buildAnalysisPack(db, { days });
            sendDownload(res, {
                filename: `botpodpopcorn-analysis-${days}d.md`,
                contentType: 'text/markdown; charset=utf-8',
                body: analysisToMarkdown(pack),
            });
            return;
        }

        if (path === '/v1/admin/export/db' && req.method === 'GET') {
            try {
                db.pragma('wal_checkpoint(TRUNCATE)');
            } catch {
                /* ignore */
            }
            const dbPath = getDbPath();
            if (!existsSync(dbPath)) {
                sendJson(res, 404, { ok: false, reason: 'db_missing' });
                return;
            }
            const name = basename(dbPath) || 'license.db';
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${name}"`,
                'Access-Control-Allow-Origin': '*',
            });
            createReadStream(dbPath).pipe(res);
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
    console.log('[license] admin panel: login with an admin plan key');
    if (ADMIN_TOKEN) console.log('[license] ADMIN_TOKEN also accepted');
});
