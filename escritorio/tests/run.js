/* Pruebas del proceso principal, sin Electron ni red: node tests/run.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const src = require('../lib/sources');
const { Store } = require('../lib/store');
const updater = require('../lib/updater');
const fx = require('./fixtures');

let passed = 0;
let failed = 0;
const pending = [];
function test(name, fn) {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(
        () => passed++,
        (e) => {
          failed++;
          console.error('✗ ' + name + '\n  ' + e.message);
        }
      )
  );
}
function assert(c, m) {
  if (!c) throw new Error(m || 'aserción fallida');
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fe-'));
const FIX = fx.writeAll(tmp());

// fetch falso: el mismo que usa main.js con FE_FIXTURES
function fakeFetch(dir) {
  return async (url) => {
    const u = new URL(url);
    let file = null;
    if (u.hostname.includes('yahoo')) file = path.join(dir, 'yahoo-' + decodeURIComponent(u.pathname.split('/').pop()) + '.json');
    else if (u.hostname.includes('news.google')) file = path.join(dir, 'news.xml');
    const ok = file && fs.existsSync(file);
    const body = ok ? fs.readFileSync(file, 'utf8') : JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } });
    return { ok, status: ok ? 200 : 404, json: async () => JSON.parse(body), text: async () => body };
  };
}

test('Yahoo: fecha del mercado (UTC−5), omite días sin cierre', () => {
  const j = fx.yahooChart('X.CL', [2026, 0, 5], 10, 100, 1);
  const r = src.parseYahoo(j, 'X.CL');
  assert(r.dates.length === 9, 'un día sin cierre se omite: ' + r.dates.length);
  assert(r.dates[0] === '2026-01-05', r.dates[0]);
  assert(r.currency === 'COP');
  let err = null;
  try {
    src.parseYahoo({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }, 'Y.CL');
  } catch (e) {
    err = e;
  }
  assert(err && /no encontró el símbolo Y.CL/.test(err.message));
});

test('URL de Yahoo y de Google News', () => {
  assert(src.yahooUrl('PFCIBEST.CL', '5y').includes('/v8/finance/chart/PFCIBEST.CL?range=5y&interval=1d'));
  const u = src.newsUrl('Grupo Sura acción', 7);
  assert(u.startsWith('https://news.google.com/rss/search?q=') && u.includes('gl=CO') && u.includes('when%3A7d'), u);
});

test('RSS de Google News: CDATA, entidades y medio fuera del título', () => {
  const items = src.parseRss(fx.NEWS, 'ECOPETROL');
  assert(items.length === 3);
  assert(items[0].title === 'Ecopetrol reporta utilidades de $3,2 billones en el trimestre', items[0].title);
  assert(items[0].source === 'Portafolio' && items[0].date === '2026-09-28T14:05:00.000Z');
  assert(items[1].title === 'Acciones de Grupo Cibest & PF Cibest suben 3 %', items[1].title);
  assert(items[2].title === 'El COLCAP cierra en máximos del año', items[2].title);
});

test('almacén: la BVC tiene prioridad sobre la fuente automática', () => {
  const st = new Store(tmp());
  st.mergePrices('ECOPETROL', ['2026-08-14', '2026-08-18'], [2740, 2771], 'yahoo');
  const n = st.mergePrices('ECOPETROL', ['2026-08-14'], [2745], 'bvc');
  assert(n === 1);
  st.mergePrices('ECOPETROL', ['2026-08-14', '2026-08-19'], [2741, 2790], 'yahoo');
  const h = st.history('ECOPETROL');
  assert(h.dates.join() === '2026-08-14,2026-08-18,2026-08-19');
  assert(h.prices[0] === 2745 && h.sources[0] === 'bvc', 'la BVC no se sobrescribe');
  st.save();
  const again = new Store(path.dirname(st.file));
  assert(again.history('ECOPETROL').prices[2] === 2790, 'se guarda en disco');
});

test('actualización: precios y noticias con respuestas grabadas; símbolo inexistente queda como error', async () => {
  const st = new Store(tmp());
  const f = fakeFetch(FIX);
  const p = await updater.updatePrices(st, f);
  const names = p.updated.map((u) => u.name);
  assert(names.includes('ECOPETROL') && names.includes('ICOLCAP'), names.join());
  assert(st.history('ECOPETROL').dates.length === 399);
  assert(st.data.meta.errors.GEB && /no encontró el símbolo GEB.CL/.test(st.data.meta.errors.GEB), 'GEB no existe en las respuestas grabadas');
  const nw = await updater.updateNews(st, f);
  assert(nw.fresh.length === 3, 'noticias nuevas: ' + nw.fresh.length);
  const again = await updater.updateNews(st, f);
  assert(again.fresh.length === 0, 'no se repiten');
  const series = st.series('todos');
  assert(series.length === 5 && series.every((s) => s.dates.length >= 3));
  assert(st.series('cargados').length === 0, 'sin descargas de la BVC no hay datos «cargados»');
  // segunda vez: solo el último mes
  let asked = '';
  await updater.updatePrices(st, async (url) => {
    asked += url;
    return f(url);
  });
  assert(/range=1mo/.test(asked), 'con historia ya guardada pide 1 mes');
});

test('importación de un CSV de la BVC', () => {
  const st = new Store(tmp());
  const r = updater.importFiles(st, [path.join(FIX, 'ECOPETROL_20260908_045259.csv'), path.join(FIX, 'news.xml')], null);
  assert(r.assets.ECOPETROL === 3, JSON.stringify(r));
  assert(r.errors.length === 1 && /news\.xml/.test(r.errors[0]));
  const h = st.history('ECOPETROL');
  assert(h.dates.join() === '2026-08-13,2026-08-14,2026-08-18' && h.sources.every((s) => s === 'bvc'));
  st.mergePrices('ECOPETROL', ['2026-08-19'], [2800], 'yahoo');
  assert(st.series('cargados')[0].dates.length === 3 && st.series('todos')[0].dates.length === 4, 'solo cargados excluye la fuente automática');
  const x = updater.importFiles(st, ['/no/existe/libro.xlsx'], null);
  assert(/sección Datos/.test(x.errors[0]), x.errors[0]);
});

test('un índice importado se marca como índice', () => {
  const st = new Store(tmp());
  const d = tmp();
  fs.writeFileSync(path.join(d, 'MSCI_COLCAP_20260915_2.csv'), '﻿Fecha;Valor hoy;Valor ayer;Variación absoluta\n2026/02/23;2,468.58;2,417.81;50.77\n2026/02/24;2,395.81;2,468.58;-72.77\n');
  st.data.assets = st.data.assets.filter((a) => a.name !== 'MSCI COLCAP');
  updater.importFiles(st, [path.join(d, 'MSCI_COLCAP_20260915_2.csv')], null);
  const a = st.asset('MSCI COLCAP');
  assert(a && a.index && st.history('MSCI COLCAP').prices[0] === 2468.58);
});

Promise.all(pending).then(() => {
  console.log(`${passed} pruebas correctas, ${failed} fallidas`);
  if (failed) process.exit(1);
});
