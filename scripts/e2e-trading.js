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
  const start = symbol.startsWith('BTC') ? 60000 : symbol.startsWith('XAU') ? 2400 : /JPY$/.test(symbol) ? 150 : 1.08;
  const C = U.synthetic(5000, { seed, intervalMs: step, end: Date.now(), start, vol: 0.003 });
  const last = C[C.length - 1];
  C.push({ t: last.t + step, o: last.c, h: last.c * 1.0005, l: last.c * 0.9995, c: last.c, v: 10, T: last.t + 2 * step - 1 });
  return (markets[key] = C);
}
const row = (k) => [k.t, String(k.o), String(k.h), String(k.l), String(k.c), String(k.v), k.T, '0', 100, '0', '0', '0'];

// Tipos del BCE simulados: paseo aleatorio diario por divisa (base EUR), solo días laborables.
const LEVEL = { USD: 1.13, JPY: 178, GBP: 0.855, CHF: 0.94, CAD: 1.58, AUD: 1.72, NZD: 1.95, MXN: 21, TRY: 47 };
const ecbDays = {};
function ecbRate(c, d) {
  if (!ecbDays[c]) {
    const R = U.rng(c.charCodeAt(0) * 7 + c.charCodeAt(2));
    const arr = [];
    let x = LEVEL[c] || 1;
    for (let k = 0; k < 12000; k++) arr.push((x *= Math.exp(0.004 * R.normal())));
    ecbDays[c] = arr;
  }
  const k = Math.floor((Date.parse(d) - Date.UTC(2002, 0, 1)) / 86400e3);
  const a = ecbDays[c];
  return +(a[k] / a[a.length - 1] * (LEVEL[c] || 1)).toFixed(4);
}
const TD_BACK = { '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '1day': '1d', '1week': '1w' };
const tdStamp = (t, daily) => new Date(t).toISOString().slice(0, daily ? 10 : 19).replace('T', ' ');

async function mockForex(page) {
  await page.route(/api\.frankfurter\.(dev|app)/, (route) => {
    const u = new URL(route.request().url());
    const q = Object.fromEntries(u.searchParams);
    const syms = (q.symbols || Object.keys(LEVEL).join(',')).split(',');
    const today = new Date().toISOString().slice(0, 10);
    const ratesOn = (d) => Object.fromEntries(syms.map((c) => [c, ecbRate(c, d)]));
    if (/latest$/.test(u.pathname)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ base: 'EUR', date: today, rates: ratesOn(today) }) });
    const m = u.pathname.match(/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})?/);
    const rates = {};
    for (let t = Date.parse(m[1]); t <= Date.parse(m[2] || today); t += 86400e3) {
      const wd = new Date(t).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const d = new Date(t).toISOString().slice(0, 10);
      rates[d] = ratesOn(d);
    }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ base: 'EUR', start_date: m[1], end_date: m[2] || today, rates }) });
  });
  await page.route(/api\.twelvedata\.com/, (route) => {
    const u = new URL(route.request().url());
    const q = Object.fromEntries(u.searchParams);
    const json = (b) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    if (q.apikey !== 'clave-prueba') return json({ code: 401, message: '**apikey** parameter is incorrect or not specified.', status: 'error' });
    if (u.pathname.endsWith('/time_series')) {
      const iv = TD_BACK[q.interval];
      let C = market(q.symbol, iv);
      if (q.end_date) C = C.filter((k) => k.t <= Date.parse(q.end_date.replace(' ', 'T') + 'Z'));
      C = C.slice(-(+q.outputsize || 30));
      const daily = iv === '1d' || iv === '1w';
      return json({ meta: { symbol: q.symbol, interval: q.interval }, status: 'ok', values: C.map((k) => ({ datetime: tdStamp(k.t, daily), open: String(k.o), high: String(k.h), low: String(k.l), close: String(k.c) })) });
    }
    if (u.pathname.endsWith('/quote')) {
      const C = market(q.symbol, '1h');
      return json({ symbol: q.symbol, close: String(C[C.length - 1].c), previous_close: String(C[C.length - 25].c), high: String(C[C.length - 1].c * 1.004), low: String(C[C.length - 1].c * 0.996) });
    }
    return json({ code: 404, message: 'not found', status: 'error' });
  });
  const now = Date.now();
  const iso = (ms) => new Date(now + ms).toISOString().replace('Z', '+00:00');
  await page.route(/nfs\.faireconomy\.media/, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { title: 'ISM Manufacturing PMI', country: 'USD', date: iso(-3 * 3600e3), impact: 'High', forecast: '54.8', previous: '54.6' },
    { title: 'BOJ Gov Speaks', country: 'JPY', date: iso(5 * 3600e3), impact: 'Medium', forecast: '', previous: '' },
    { title: 'Non-Farm Employment Change', country: 'USD', date: iso(10 * 3600e3), impact: 'High', forecast: '90K', previous: '162K' },
    { title: 'CPI Flash Estimate y/y', country: 'EUR', date: iso(30 * 3600e3), impact: 'High', forecast: '3.4%', previous: '3.2%' },
    { title: 'Retail Sales m/m', country: 'AUD', date: iso(40 * 3600e3), impact: 'Low', forecast: '0.2%', previous: '0.1%' },
  ]) }));
}

async function mockBinance(page, ws) {
  await mockForex(page);
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
  await page.click('#notice-ok');

  // 1) Divisas sin clave: EUR/USD diario con los tipos del BCE
  check('EUR/USD con datos del BCE', (await page.evaluate(() => window.__radar.state.feed.id)) === 'ecb' && (await page.textContent('#q-sym')) === 'EUR/USD');
  check('fuente por sondeo', (await page.getAttribute('#conn', 'data-state')) === 'poll');
  check('intradía desactivado sin clave', await page.$eval('#interval option[value="1h"]', (o) => o.disabled));
  await page.waitForFunction(() => /alto impacto/.test(document.querySelector('#signal').textContent), null, { timeout: 8000 }).catch(() => {});
  check('aviso de noticia de alto impacto', /Non-Farm/.test(await page.textContent('#signal')));
  await page.click('.tabs [data-tab="forex"]');
  await page.waitForSelector('#tab-forex .srow', { timeout: 10000 });
  check('fuerza de 8 divisas', (await page.$$('#tab-forex .srow')).length === 8);
  check('sesiones', (await page.$$('#fx-sessions tbody tr')).length === 4);
  check('calendario filtrado (USD y EUR)', /Non-Farm/.test(await page.textContent('#tab-forex')) && !/Retail Sales/.test(await page.textContent('#tab-forex')));
  check('matriz de correlaciones', (await page.$$('#tab-forex .corr tbody tr')).length === 8);
  if (shots) await page.screenshot({ path: shots + '/divisas.png', fullPage: true });

  // 2) Con clave de Twelve Data: velas intradía de divisas y oro
  await page.click('#settings summary');
  await page.fill('#tdKey', 'clave-prueba');
  await page.press('#tdKey', 'Tab');
  await page.waitForFunction(() => window.__radar.state.feed && window.__radar.state.feed.id === 'twelvedata', null, { timeout: 10000 }).catch(() => {});
  await page.selectOption('#interval', '1h');
  await page.waitForFunction(() => window.__radar.state.ctx && window.__radar.state.ctx.stepMs === 3600e3 && window.__radar.state.feed.id === 'twelvedata', null, { timeout: 15000 }).catch(() => {});
  check('EUR/USD intradía con Twelve Data', (await page.evaluate(() => window.__radar.state.candles.length)) >= 900 && (await page.evaluate(() => window.__radar.state.feed.id)) === 'twelvedata');
  await page.click('.tabs [data-tab="risk"]');
  await page.click('#rk-fill');
  check('lotes y valor del pip', /lotes|Lotes/.test(await page.textContent('#rk-out')) && /pips/.test(await page.textContent('#rk-out')));
  await page.click('#settings summary');
  if (shots) await page.screenshot({ path: shots + '/escritorio-forex.png', fullPage: true });
  await page.fill('#symbol', 'xauusd');
  await page.press('#symbol', 'Enter');
  await page.waitForFunction(() => document.querySelector('#q-sym').textContent === 'XAU/USD' && window.__radar.state.candles.length > 900, null, { timeout: 15000 }).catch(() => {});
  check('oro (XAU/USD)', (await page.textContent('#q-sym')) === 'XAU/USD');

  // 3) Binance: EURUSDT en directo por WebSocket
  await page.fill('#symbol', 'EURUSDT');
  await page.press('#symbol', 'Enter');
  await page.waitForFunction(() => document.querySelector('#conn').dataset.state === 'live', null, { timeout: 10000 }).catch(() => {});
  check('Binance en directo', (await page.getAttribute('#conn', 'data-state')) === 'live');
  await page.click('.tabs [data-tab="projection"]');
  check('proyección con cono', (await page.$$('#tab-projection .card')).length >= 6);
  if (shots) await page.screenshot({ path: shots + '/escritorio.png', fullPage: true });

  // Vela en directo que cierra → nuevo análisis
  const before = await page.evaluate(() => window.__radar.state.cur.t);
  const C = market('EURUSDT', '1h');
  const open = C[C.length - 1];
  const step = 3600e3;
  const k = (o) => JSON.stringify({ e: 'kline', s: 'EURUSDT', k: Object.assign({ i: '1h', o: String(open.o), h: String(open.h), l: String(open.l), c: String(open.c * 1.001), v: '20' }, o) });
  const ws = sockets[sockets.length - 1];
  ws.send(k({ t: open.t, T: open.T, x: false }));
  ws.send(k({ t: open.t, T: open.T, x: true }));
  ws.send(k({ t: open.t + step, T: open.T + step, x: false }));
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
  await page.waitForFunction(() => document.querySelectorAll('#scan-table tr.click').length >= 7, null, { timeout: 15000 }).catch(() => {});
  check('escáner con divisas y Binance', (await page.$$('#scan-table tr.click')).length >= 7);
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
