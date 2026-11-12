# FOREV EXT

Локально (Node 22.5+):  node server.js   ->  http://localhost:3000
Ключ локально:          node server.js genkey 30

## Render
1. Залейте содержимое папки в GitHub (server.js, package.json, render.yaml, public/).
2. Render -> New -> Blueprint -> выберите репозиторий -> Apply.
3. В Environment сервиса скопируйте ADMIN_TOKEN.
4. Выдача ключей:
   curl -X POST https://ВАШ-САЙТ.onrender.com/api/admin/genkey \
     -H "x-admin-token: ВАШ_ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"days":30,"count":5}'
База лежит на диске /var/data (без диска на Render данные стираются при каждом перезапуске).

## Анти-сон (бесплатный Render)
- keepalive.js пингует сайт сам. В Render -> Environment задайте PING_URL (адрес сайта)
  и при желании PING_INTERVAL_MIN (по умолчанию 10 мин).
- Резерв: .github/workflows/keepalive.yml пингует снаружи каждые 5 минут.
  В GitHub -> Settings -> Secrets and variables -> Actions -> Variables создайте PING_URL.
- Можно вместо этого завести монитор на uptimerobot.com на адрес /health.
