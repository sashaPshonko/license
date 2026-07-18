# App updates (electron-updater generic)

Положить сюда файлы из `oluh-bot/dist/` после сборки:

- `latest.yml` + `botpodpopcorn-*-win-x64.exe` (+ `.blockmap`) — Windows
- `latest-mac.yml` + `botpodpopcorn-*-mac-*.zip` — Mac (тест)

Залить с Mac:

```bash
cd oluh-bot
npm run dist:win   # нужен wine, либо собери на Windows/VPS
npm run dist:mac
npm run push:updates   # scp в updates/ на VPS
```

Или вручную:

```bash
scp dist/latest.yml dist/botpodpopcorn-*-win-x64.exe* root@SERVER:~/license/updates/
```
