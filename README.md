# botpodpopcorn license

Сервер ключей подписки + аналитика покупок/продаж (без логинов/паролей).

## Запуск

```bash
cd ~/license
npm install   # один раз
chmod +x scripts/run/license.sh scripts/run/stop.sh

# с автоперезапуском (как у ботов / sell)
nohup bash scripts/run/license.sh > server.log 2>&1 &

# остановить
bash scripts/run/stop.sh
```

По умолчанию: `http://0.0.0.0:8787`  
Админка: открыть в браузере тот же URL.

Вкладки:
- **Покупки ключей** — все выдачи (дата, план, заметка, net юзера)
- **На чём зарабатывают** — прибыль по предметам у всех подписчиков
- **Для Cursor** — скачать `analysis.md` / `analysis.json` / `license.db`

Экспорт:
```
GET /v1/admin/export/analysis.md?days=30
GET /v1/admin/export/analysis.json?days=30
GET /v1/admin/export/db
```

При первом старте создаётся **admin**-ключ (печатается в `server.log`).

Проверка:
```bash
curl -sS http://127.0.0.1:8787/ | head
tail -f server.log
```

### Env

| var | default | смысл |
|-----|---------|--------|
| `PORT` | `8787` | порт |
| `HOST` | `0.0.0.0` | bind |
| `ADMIN_TOKEN` | пусто | доп. токен (опционально); основной вход — **admin-ключ** |
| `LICENSE_DB` | `data/license.db` | sqlite |
| `SESSION_TTL_MS` | `45000` | без heartbeat сессия умирает |
| `HEARTBEAT_MS` | `15000` | как часто клиенту пинговать |

### App updates

Статика для `electron-updater` (generic):

```
GET /updates/latest.yml
GET /updates/botpodpopcorn-…-win-x64.exe
GET /updates/latest-mac.yml
…
```

Файлы лежат в `license/updates/` (не в git). Заливка с Mac: `oluh-bot` → `npm run push:updates`.

Админка: http://host:8787/ — логин **admin-ключом** (plan=admin).

Сессии: клиент шлёт heartbeat; если молчит дольше `SESSION_TTL_MS` — сессия неактивна, можно войти снова.

## Bot API

- `POST /v1/session/start` `{ key, deviceId?, appVersion? }`
- `POST /v1/session/heartbeat` `{ sessionId }`
- `POST /v1/session/stop` `{ sessionId, reason? }`
- `POST /v1/events/trades` `{ sessionId, trades: [{ side, price, label, type, enchants, integrity, anarchy, profit?, ts? }] }`

Ответ `session/start` включает `maxBots`: normal=1, pro=20, admin=100.

## Планы

- `normal` / `pro` — N дней, **1** живая сессия
- `admin` — бессрочно, без лимита сессий
