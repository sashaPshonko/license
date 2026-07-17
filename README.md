# botpodpopcorn license

Сервер ключей подписки + аналитика покупок/продаж (без логинов/паролей).

## Запуск

```bash
cd botpodpopcorn-license
node src/server.mjs
```

По умолчанию: `http://0.0.0.0:8787`  
Админка: открыть в браузере тот же URL.

При первом старте создаётся **admin**-ключ (печатается в консоль).

### Env

| var | default | смысл |
|-----|---------|--------|
| `PORT` | `8787` | порт |
| `HOST` | `0.0.0.0` | bind |
| `ADMIN_TOKEN` | пусто | если задан — нужен для `/v1/admin/*` |
| `LICENSE_DB` | `data/license.db` | sqlite |
| `SESSION_TTL_MS` | `90000` | сессия умирает без heartbeat |
| `HEARTBEAT_MS` | `30000` | подсказка клиенту |

## Bot API

- `POST /v1/session/start` `{ key, deviceId?, appVersion? }`
- `POST /v1/session/heartbeat` `{ sessionId }`
- `POST /v1/session/stop` `{ sessionId, reason? }`
- `POST /v1/events/trades` `{ sessionId, trades: [{ side, price, label, type, enchants, integrity, anarchy, profit?, ts? }] }`

Ответ `session/start` включает `maxBots`: normal=1, pro=20, admin=100.

## Планы

- `normal` / `pro` — N дней, **1** живая сессия
- `admin` — бессрочно, без лимита сессий
