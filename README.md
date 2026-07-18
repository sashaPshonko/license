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
