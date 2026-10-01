/* Mercados simulados para las pruebas de extremo a extremo: Binance (REST y
 * WebSocket), Twelve Data, tipos del BCE (Frankfurter) y calendario de Forex
 * Factory, interceptados con Playwright para no depender de la red. */
require('../trading/js/core.js');
const U = globalThis.FX.util;

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

module.exports = { market, mockBinance, mockForex };
