// keepalive.js — пингует сайт, чтобы бесплатный Render не засыпал.
// Настройка через переменные окружения (Render -> Environment):
//   PING_URL           адрес сайта, например https://forev-ext.onrender.com
//                      (если не задан — берётся RENDER_EXTERNAL_URL, его Render ставит сам)
//   PING_INTERVAL_MIN  как часто пинговать, в минутах (по умолчанию 10, максимум 14)
module.exports = function startKeepAlive() {
  const base = (process.env.PING_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  if (!base) return console.log('[keepalive] выключен: PING_URL не задан');
  const min = Math.max(1, Math.min(+process.env.PING_INTERVAL_MIN || 10, 14));
  const ping = async () => {
    try {
      const r = await fetch(base + '/health', { signal: AbortSignal.timeout(20000) });
      if (!r.ok) console.log('[keepalive] ответ', r.status);
    } catch (e) { console.log('[keepalive] ошибка:', e.message); }
  };
  setInterval(ping, min * 60000);
  console.log(`[keepalive] каждые ${min} мин -> ${base}/health`);
};
