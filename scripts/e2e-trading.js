/* Prueba de extremo a extremo de Radar de Divisas con Binance simulado
 * (REST y WebSocket interceptados por Playwright), para no depender de la red.
 * Uso: node scripts/e2e-trading.js [carpeta-capturas] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('../trading/js/core.js');
const U = globalThis.FX.util;

const root = path.join(__dirname, '..');
const shots = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

// Mercado simulado: 5 000 velas por par e intervalo, la última aún abierta.
const markets = {};
function market(symbol, interval) {
  const key = symbol + interval;
  if (markets[key]) return markets[key];
  const step = U.INTERVALS[interval];
  let seed = 0;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const C = U.synthetic(5000, { seed, intervalMs: step, end: Date.now(), start: symbol.startsWith('BTC') ? 60000 : 1.08, vol: 0.003 });
  const last = C[C.length - 1];
  C.push({ t: last.t + step, o: last.c, h: last.c * 1.0005, l: last.c * 0.9995, c: last.c, v: 10, T: last.t + 2 * step - 1 });
  return (markets[key] = C);
}
const row = (k) => [k.t, String(k.o), String(k.h), String(k.l), String(k.c), String(k.v), k.T, '0', 100, '0', '0', '0'];

async function mockBinance(page, ws) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/fapi\.binance\.com/, (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"code":-1121,"msg":"Invalid symbol."}' }));
  await page.route(/binance\.(vision|com)\/api\/v3\//, (route) => {
    const u = new URL(route.request().url());
    const q = Object.fromEntries(u.searchParams);
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (q.symbol === 'NOEXISTE') return json({ code: -1121, msg: 'Invalid symbol.' }, 400);
    if (u.pathname.endsWith('/klines')) {
      let C = market(q.symbol, q.interval);
      if (q.endTime) C = C.filter((k) => k.t <= +q.endTime);
      return json(C.slice(-(+q.limit || 500)).map(row));
    }
    if (u.pathname.endsWith('/exchangeInfo')) {
      const fx = q.symbol.startsWith('EUR');
      return json({ symbols: [{ symbol: q.symbol, status: 'TRADING', baseAsset: q.symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', filters: [
        { filterType: 'PRICE_FILTER', tickSize: fx ? '0.00010000' : '0.01000000' },
        { filterType: 'LOT_SIZE', stepSize: fx ? '0.10000000' : '0.00001000', minQty: '0.1' },
        { filterType: 'NOTIONAL', minNotional: '5.00000000' },
      ] }] });
    }
    if (u.pathname.endsWith('/ticker/24hr')) {
      const C = market(q.symbol, '1h');
      const last = C[C.length - 1];
      const open = C[C.length - 25].o;
      return json({ symbol: q.symbol, openPrice: String(open), lastPrice: String(last.c), highPrice: String(last.c * 1.01), lowPrice: String(last.c * 0.99), quoteVolume: '123456789' });
    }
    if (u.pathname.endsWith('/ticker/price')) return json(['EURUSDT', 'BTCUSDT', 'ETHUSDT', 'PAXGUSDT'].map((s) => ({ symbol: s, price: '1' })));
    return json({}, 404);
  });
  await page.routeWebSocket(/binance/, (socket) => ws.push(socket));
}

(async () => {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/trading/index.html`;
  const browser = await chromium.launch();
  const errors = [];
  const results = {};
  const check = (name, cond) => {
    results[name] = !!cond;
    if (!cond) errors.push('Falla: ' + name);
  };

  // Escritorio
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|fonts|ERR_FAILED/.test(m.text()) && errors.push(m.text()));
  const sockets = [];
  await mockBinance(page, sockets);
  await page.goto(base);
  await page.waitForSelector('#signal .verdict', { timeout: 20000 });
  check('señal renderizada', await page.isVisible('#signal .verdict'));
  check('conectado en directo', await page.waitForFunction(() => document.querySelector('#conn').dataset.state === 'live', null, { timeout: 10000 }).then(() => true, () => false));
  check('proyección con cono', (await page.$$('#tab-projection .card')).length >= 6);
  await page.click('#notice-ok');
  if (shots) await page.screenshot({ path: shots + '/escritorio.png', fullPage: true });

  // Vela en directo que cierra → nuevo análisis
  const before = await page.evaluate(() => window.__radar.state.cur.t);
  const C = market('EURUSDT', '1h');
  const open = C[C.length - 1];
  const step = 3600e3;
  const k = (o) => JSON.stringify({ e: 'kline', s: 'EURUSDT', k: Object.assign({ i: '1h', o: String(open.o), h: String(open.h), l: String(open.l), c: String(open.c * 1.001), v: '20' }, o) });
  sockets[0].send(k({ t: open.t, T: open.T, x: false }));
  sockets[0].send(k({ t: open.t, T: open.T, x: true }));
  sockets[0].send(k({ t: open.t + step, T: open.T + step, x: false }));
  await page.waitForFunction((b) => window.__radar.state.cur.t > b, before, { timeout: 5000 }).catch(() => {});
  check('recalcula al cerrar la vela', (await page.evaluate(() => window.__radar.state.cur.t)) > before);

  for (const tab of ['analysis', 'patterns', 'scanner', 'alerts', 'risk', 'guide']) {
    await page.click(`.tabs [data-tab="${tab}"]`);
    await page.waitForTimeout(150);
  }
  await page.click('.tabs [data-tab="analysis"]');
  check('desglose por escuela', (await page.$$('#tab-analysis .group-row')).length >= 8);
  await page.click('.tabs [data-tab="scanner"]');
  await page.waitForFunction(() => document.querySelectorAll('#scan-table tr.click').length >= 2, null, { timeout: 15000 }).catch(() => {});
  check('escáner con filas', (await page.$$('#scan-table tr.click')).length >= 2);
  if (shots) await page.screenshot({ path: shots + '/escaner.png' });
  await page.click('.tabs [data-tab="risk"]');
  await page.click('#rk-fill');
  check('calculadora de riesgo', (await page.$$('#rk-out .card')).length >= 3);
  await page.click('.tabs [data-tab="backtest"]');
  await page.click('#bt-run');
  await page.waitForSelector('#bt-out .cards', { timeout: 30000 });
  check('backtest', (await page.$$('#bt-out .card')).length >= 8);
  if (shots) await page.screenshot({ path: shots + '/backtest.png', fullPage: true });
  for (const layer of ['bb', 'ich', 'fib']) await page.click(`[data-layer="${layer}"]`);
  await page.selectOption('#lower', 'macd');
  await page.mouse.move(500, 400);
  await page.waitForTimeout(200);
  if (shots) await page.locator('.chart-panel').screenshot({ path: shots + '/grafico-capas.png' });
  await page.click('.tabs [data-tab="projection"]');
  await page.locator('#tab-projection').screenshot({ path: shots ? shots + '/proyeccion.png' : path.join(require('os').tmpdir(), 'p.png') });

  // Par inexistente → error → modo demostración
  await page.fill('#symbol', 'noexiste');
  await page.press('#symbol', 'Enter');
  await page.waitForSelector('#load-error:not([hidden])', { timeout: 10000 });
  check('error de par inexistente', /no existe/.test(await page.textContent('#load-error')));
  await page.click('#demo');
  await page.waitForFunction(() => document.querySelector('#conn').dataset.state === 'demo', null, { timeout: 5000 });
  check('modo demostración', await page.isVisible('#signal .verdict'));
  await page.close();

  // Móvil
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
  m.on('pageerror', (e) => errors.push('móvil: ' + e.message));
  await mockBinance(m, []);
  await m.goto(base);
  await m.waitForSelector('#signal .verdict', { timeout: 20000 });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('sin desbordamiento horizontal en móvil', overflow <= 0);
  if (shots) {
    await m.click('#notice-ok');
    await m.screenshot({ path: shots + '/movil.png' });
    await m.locator('#signal').scrollIntoViewIfNeeded();
    await m.screenshot({ path: shots + '/movil-senal.png' });
  }

  await browser.close();
  srv.close();
  console.log(JSON.stringify({ results, errors }, null, 1));
  process.exit(errors.length ? 1 : 0);
})();
