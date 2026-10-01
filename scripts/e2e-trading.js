/* Prueba de extremo a extremo de Radar de Divisas con Binance simulado
 * (REST y WebSocket interceptados por Playwright), para no depender de la red.
 * Uso: node scripts/e2e-trading.js [carpeta-capturas] */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

const { market, mockBinance } = require('./mock-markets');

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
