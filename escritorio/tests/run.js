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
    else if (u.hostname.includes('fred')) file = path.join(dir, 'fred-' + u.searchParams.get('id') + '.csv');
    else if (u.hostname.includes('worldbank')) file = path.join(dir, 'wb-' + u.pathname.split('/')[5] + '.json');
    else if (u.hostname.includes('datos.gov.co')) file = path.join(dir, 'socrata-trm.json');
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
  const n = st.mergePrices('ECOPETROL', ['2026-08-14'], [1520], 'bvc');
  assert(n === 1);
  st.mergePrices('ECOPETROL', ['2026-08-14', '2026-08-19'], [2741, 1560], 'yahoo');
  const h = st.history('ECOPETROL');
  assert(h.dates.join() === '2026-08-14,2026-08-18,2026-08-19');
  assert(h.prices[0] === 1520 && h.sources[0] === 'bvc', 'la BVC no se sobrescribe');
  st.save();
  const again = new Store(path.dirname(st.file));
  assert(again.history('ECOPETROL').prices[2] === 1560, 'se guarda en disco');
});

test('actualización: solo divisas de la fuente automática; acciones, índices y ETF solo de la BVC', async () => {
  const st = new Store(tmp());
  // La app arranca vacía: el usuario agrega sus activos (aquí, el dólar, el euro y una acción)
  st.ensureAsset('USD/COP').yahoo = 'COP=X';
  st.ensureAsset('EUR/COP').yahoo = 'EURCOP=X';
  st.ensureAsset('ECOPETROL');
  const f = fakeFetch(FIX);
  let asked = '';
  const p = await updater.updatePrices(st, async (url) => {
    asked += url + ' ';
    return f(url);
  });
  const names = p.updated.map((u) => u.name);
  assert(names.join() === 'USD/COP', 'solo el dólar: ' + names.join());
  assert(!/\.CL/.test(asked), 'no se piden acciones a la fuente automática: ' + asked);
  assert(!st.history('ECOPETROL').dates.length && st.asset('ECOPETROL').yahoo === '', 'ECOPETROL sin cierres automáticos');
  assert(st.data.meta.errors['EUR/COP'], 'EUR/COP no está en las respuestas grabadas');
  const nw = await updater.updateNews(st, f);
  assert(nw.fresh.length === 3, 'noticias nuevas: ' + nw.fresh.length);
  const again = await updater.updateNews(st, f);
  assert(again.fresh.length === 0, 'no se repiten');
  const series = st.series();
  assert(series.length === 1 && series[0].name === 'USD/COP' && series[0].dates.length > 300);
  // Aunque alguien escriba un símbolo automático para una acción, no se usa
  st.asset('ECOPETROL').yahoo = 'ECOPETROL.CL';
  asked = '';
  await updater.updatePrices(st, async (url) => {
    asked += url;
    return f(url);
  });
  assert(/range=1mo/.test(asked) && !/ECOPETROL/.test(asked), 'con historia ya guardada pide 1 mes, y nunca acciones');
});

test('quien ya usaba la app pierde los cierres automáticos de acciones y conserva los de la BVC', () => {
  const dir = tmp();
  const old = new Store(dir);
  old.mergePrices('ECOPETROL', ['2026-08-13', '2026-08-14', '2026-08-19'], [1500, 1520, 1560], 'yahoo');
  old.mergePrices('ECOPETROL', ['2026-08-13', '2026-08-14', '2026-08-18'], [1500, 1520, 1540], 'bvc');
  old.mergePrices('USD/COP', ['2026-08-13', '2026-08-14', '2026-08-18'], [4000, 4010, 4020], 'yahoo');
  old.asset('ECOPETROL').yahoo = 'ECOPETROL.CL';
  old.data.meta.defaults = 4;
  old.save();
  const st = new Store(dir);
  const h = st.history('ECOPETROL');
  assert(h.dates.join() === '2026-08-13,2026-08-14,2026-08-18' && h.sources.every((x) => x === 'bvc') && h.prices[1] === 1520, 'ECOPETROL: ' + h.dates.join());
  assert(st.asset('ECOPETROL').yahoo === '' && !st.asset('USD/COP') && !st.data.prices['USD/COP'], 'el dólar descargado solo se quita (2.6.4: sin datos predeterminados)');
});

test('importación de un CSV de la BVC', () => {
  const st = new Store(tmp());
  const r = updater.importFiles(st, [path.join(FIX, 'ECOPETROL_20260908_045259.csv'), path.join(FIX, 'news.xml')], null);
  assert(r.assets.ECOPETROL === 3, JSON.stringify(r));
  assert(r.errors.length === 1 && /news\.xml/.test(r.errors[0]));
  const h = st.history('ECOPETROL');
  assert(h.dates.join() === '2026-08-13,2026-08-14,2026-08-18' && h.sources.every((s) => s === 'bvc'));
  st.mergePrices('ECOPETROL', ['2026-08-19'], [1600], 'yahoo');
  assert(st.series().find((x) => x.name === 'ECOPETROL').dates.length === 3, 'el análisis usa solo la BVC');
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

test('respaldo: exportar e importar en otro equipo sin perder la prioridad de la BVC', () => {
  const a = new Store(tmp());
  a.mergePrices('ECOPETROL', ['2026-08-14', '2026-08-18'], [1520, 1540], 'bvc');
  a.mergePrices('NUTRESA', ['2026-08-14', '2026-08-18'], [50000, 50500], 'yahoo');
  a.addNews([{ asset: 'ECOPETROL', title: 'Titular', link: 'https://x/1', date: new Date().toISOString() }]);
  const backup = JSON.parse(JSON.stringify(a.exportData()));
  const b = new Store(tmp());
  b.mergePrices('ECOPETROL', ['2026-08-14', '2026-08-19'], [1500, 1600], 'yahoo');
  const r = b.importData(backup);
  assert(r.assets === 1 && r.news === 1, JSON.stringify(r));
  const h = b.history('ECOPETROL');
  // Solo la BVC: los cierres automáticos de acciones (de este equipo o del respaldo) no se guardan
  assert(h.dates.join() === '2026-08-14,2026-08-18' && h.prices[0] === 1520 && h.sources.every((x) => x === 'bvc'), JSON.stringify(h));
  assert(b.asset('NUTRESA') && b.history('NUTRESA').dates.length === 0);
  let err = null;
  try {
    b.importData({ hola: 1 });
  } catch (e) {
    err = e;
  }
  assert(err && /no es un respaldo/.test(err.message));
});


test('renta fija por tasas: se guarda la tasa y el análisis recibe el índice de rendimiento total', () => {
  const st = new Store(tmp());
  const d = tmp();
  fs.writeFileSync(path.join(d, 'TFIT16240728_20260915.csv'), 'Fecha;Nemotécnico;Tasa de negociación;Precio limpio\n2026-08-13;TFIT16240728;10.500;98,500.000\n2026-08-14;TFIT16240728;10.600;98,100.000\n2026-08-18;TFIT16240728;10.400;98,900.000\n');
  fs.writeFileSync(path.join(d, 'COLIBR_20260915_1.csv'), 'Fecha;Valor hoy;Valor ayer\n2026/08/13;119.10;119.07\n2026/08/14;119.13;119.10\n2026/08/18;119.20;119.13\n');
  const r = updater.importFiles(st, [path.join(d, 'TFIT16240728_20260915.csv'), path.join(d, 'COLIBR_20260915_1.csv')], null);
  assert(r.assets.TFIT16240728 === 3 && r.assets.COLIBR === 3, JSON.stringify(r));
  const a = st.asset('TFIT16240728');
  assert(a.kind === 'tasa' && a.cls === 'tes' && a.dur === 6 && st.history('TFIT16240728').prices[0] === 0.105, JSON.stringify(a));
  assert(st.asset('COLIBR').index, 'COLIBR es índice');
  const PF = updater.loadPF();
  const ser = st.series();
  const tes = PF.data.combineSeries(ser).find((x) => x.name === 'TFIT16240728');
  assert(tes.kind === 'tasa' && tes.prices[0] === 100 && tes.prices[1] < 100 && tes.prices[2] > tes.prices[1], 'índice: ' + tes.prices);
  assert(ser.find((x) => x.name === 'COLIBR').cls === 'indice');
  // El respaldo conserva el tipo y la duración
  const st2 = new Store(tmp());
  st2.importData(JSON.parse(JSON.stringify(st.exportData())));
  assert(st2.asset('TFIT16240728').kind === 'tasa' && st2.asset('TFIT16240728').dur === 6);
});

test('la app arranca sin activos ni divisas predeterminados; quien ya la usaba conserva solo lo que subió', () => {
  const nuevo = new Store(tmp());
  assert(nuevo.data.assets.length === 0 && !Object.keys(nuevo.data.prices).length, 'la app nueva arranca vacía');
  const dir = tmp();
  const old = new Store(dir);
  for (const n of ['MSCI COLCAP', 'ECOPETROL', 'PFAVAL', 'USD/COP', 'EUR/COP', 'COLTES LP']) old.ensureAsset(n);
  old.asset('USD/COP').yahoo = 'COP=X';
  old.mergePrices('USD/COP', ['2026-08-13', '2026-08-14'], [4000, 4010], 'yahoo');
  old.mergePrices('ECOPETROL', ['2026-08-13', '2026-08-14'], [2400, 2410], 'bvc');
  old.data.meta.defaults = 5;
  old.save();
  const st = new Store(dir);
  assert(st.data.assets.map((a) => a.name).join() === 'ECOPETROL', 'solo queda lo subido: ' + st.data.assets.map((a) => a.name).join());
  assert(!st.data.prices['USD/COP'] && st.history('ECOPETROL').dates.length === 2);
});

test('tramos con número de descarga (1790829234836-COLTES LP): un solo índice, nuevo o ya guardado', () => {
  const dir = tmp();
  const old = new Store(dir);
  // Como quedaban en versiones anteriores: un activo por tramo
  old.data.assets.push({ name: '1790829234836-COLTES LP', yahoo: '', news: '', index: true, enabled: true }, { name: '1790829249314-COLTES LP', yahoo: '', news: '', index: true, enabled: true });
  old.data.prices['1790829234836-COLTES LP'] = { '2026-01-02': [443.97, 'bvc'], '2026-01-05': [444, 'bvc'] };
  old.data.prices['1790829249314-COLTES LP'] = { '2026-07-01': [401.89, 'bvc'], '2026-07-02': [396.49, 'bvc'] };
  old.save();
  const st = new Store(dir);
  const coltes = st.data.assets.filter((a) => /COLTES LP/.test(a.name));
  assert(coltes.length === 1 && coltes[0].name === 'COLTES LP', coltes.map((a) => a.name).join());
  assert(st.history('COLTES LP').dates.join() === '2026-01-02,2026-01-05,2026-07-01,2026-07-02' && st.history('COLTES LP').prices[2] === 401.89);
  // Nuevos tramos descargados con número: se suman al mismo índice
  const d = tmp();
  const f1 = path.join(d, '1790829263305-COLTES LP.csv');
  const f2 = path.join(d, '1790829271528-COLTES LP.csv');
  fs.writeFileSync(f1, 'Fecha;Valor hoy;Valor ayer\n2026/08/13;411,69;410,00\n2026/08/14;412,10;411,69\n');
  fs.writeFileSync(f2, 'Fecha;Valor hoy;Valor ayer\n2026/08/18;382,48;412,10\n2026/08/19;383,00;382,48\n');
  const r = updater.importFiles(st, [f1, f2], null);
  assert(Object.keys(r.assets).join() === 'COLTES LP', JSON.stringify(r.assets));
  assert(st.data.assets.filter((a) => /COLTES/.test(a.name)).length === 1 && st.history('COLTES LP').dates.length === 8);
});

test('limpieza única: borra COLTES y renta fija leídos antes, conserva acciones y pide descargar todo', () => {
  const dir = tmp();
  const old = new Store(dir);
  old.mergePrices('COLTES LP', ['2026-01-02', '2026-01-05'], [10500, 10.6], 'bvc');
  old.ensureAsset('TES 2032', false, { cls: 'tes', kind: 'tasa', dur: 6 });
  old.mergePrices('TES 2032', ['2026-01-02', '2026-01-05'], [0.105, 0.106], 'bvc');
  old.mergePrices('ECOPETROL', ['2026-01-02', '2026-01-05'], [2400, 2410], 'bvc');
  old.data.meta.lastPrices = '2026-01-05T00:00:00Z';
  old.data.meta.defaults = 2;
  old.save();
  const st = new Store(dir);
  assert(!st.data.prices['COLTES LP'] && !st.asset('COLTES LP'), 'COLTES LP se borra para volver a cargarlo');
  assert(!st.asset('TES 2032') && !st.data.prices['TES 2032'], 'el TES importado se quita');
  assert(st.history('ECOPETROL').dates.length === 2, 'las acciones no se tocan');
  assert(st.data.meta.lastPrices === null, 'se descarga todo al abrir');
  st.save();
  const again = new Store(dir);
  again.mergePrices('COLTES LP', ['2026-02-02', '2026-02-03'], [250, 251], 'bvc');
  again.save();
  assert(new Store(dir).history('COLTES LP').dates.length === 2, 'la limpieza se hace una sola vez');
  const lib = path.join(dir, 'bib');
  fs.mkdirSync(path.join(lib, 'acciones'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'acciones', 'COLTES CP.csv'), 'viejo');
  require('../lib/biblioteca').write(again, lib);
  assert(!fs.existsSync(path.join(lib, 'acciones', 'COLTES CP.csv')) && fs.existsSync(path.join(lib, 'acciones', 'ECOPETROL.csv')), 'la carpeta queda con un archivo por activo vigente');
});

test('variables macro: fuentes con respaldo y biblioteca local', async () => {
  const st = new Store(tmp());
  const PF = updater.loadPF();
  const macro = require('../lib/macro');
  const bib = require('../lib/biblioteca');
  const r = await macro.updateMacro(st, fakeFetch(FIX), PF, () => {});
  const m = st.data.macro;
  assert(r.updated.length === 4 && r.errors.length === 0, JSON.stringify(r));
  assert(/Banco Mundial/.test(m.pib.source) && m.pib.dates[0] === '2021-12-31', 'PIB por el respaldo del Banco Mundial: ' + m.pib.source);
  assert(/FRED/.test(m.inflacion.source) && m.desempleo.dates.length === 31 && /datos\.gov\.co/.test(m.trm.source) && m.trm.values[0] > 4000);
  const again = await macro.updateMacro(st, fakeFetch(FIX), PF, () => {});
  assert(again.updated.length === 0, 'sin datos nuevos no avisa');
  // Biblioteca
  updater.importFiles(st, [path.join(FIX, 'ECOPETROL_20260908_045259.csv')], null);
  const dir = tmp();
  const w = bib.write(st, dir, [{ name: 'Paso a paso.html', html: '<p>ok</p>' }]);
  assert(w.assets >= 1 && w.vars === 4 && w.docs === 1);
  assert(w.matrix && w.matrix.assets >= 1 && fs.existsSync(path.join(dir, 'Matriz de precios.xlsx')), 'matriz de precios en la biblioteca');
  const csv = fs.readFileSync(path.join(dir, 'acciones', 'ECOPETROL.csv'), 'utf8');
  // Formato de Excel en español: punto y coma, punto de miles y coma decimal
  assert(/Fecha;Cierre;Fuente;Cantidad;Volumen/.test(csv) && /2026-08-18;1\.540;BVC;1\.000;1\.540\.000/.test(csv), csv.slice(0, 160));
  // Fiel a la fuente: solo los días negociados (sin fines de semana ni festivos)
  assert(!/2026-08-1[567]/.test(csv) && csv.trim().split('\r\n').length === 1 + 3, 'solo 13, 14 y 18 de agosto');
  assert(bib.excelNum(4230.25) === '4.230,25' && bib.excelNum(0.105 * 100) === '10,5');
  // El CSV de la biblioteca se vuelve a leer con los mismos valores
  const reread = updater.loadPF().data.parseSeriesText(csv, 'ECOPETROL.csv')[0];
  assert(reread.prices.at(-1) === 1540 && reread.vol.at(-1) === 1540000 && reread.qty.at(-1) === 1000, 'relectura: ' + reread.prices.at(-1) + ' ' + reread.vol.at(-1));
  assert(reread.dates.join() === '2026-08-13,2026-08-14,2026-08-18', 'al volver a leerlo, los días sin negociación no cuentan como cotización: ' + reread.dates.join());
  const ser = st.series().find((x) => x.name === 'ECOPETROL');
  assert(ser.qty && ser.qty.length === ser.dates.length && ser.vol.at(-1) === 1540000, 'la serie lleva cantidad y volumen');
  assert(/Fuente: datos\.gov\.co/.test(fs.readFileSync(path.join(dir, 'macro', 'trm.csv'), 'utf8')) && fs.existsSync(path.join(dir, 'macro', 'todas.csv')) && fs.existsSync(path.join(dir, 'LEEME.txt')));
  // Varios tramos de la misma acción: un solo archivo en la biblioteca
  const t2 = path.join(tmp(), 'ECOPETROL_20260908_045427.csv');
  fs.writeFileSync(t2, fx.BVC_CSV.replace(/2026-08-1(3|4|7|8)/g, (m, d) => '2026-07-1' + d));
  updater.importFiles(st, [t2], null);
  bib.write(st, dir, null);
  const ecoFiles = fs.readdirSync(path.join(dir, 'acciones')).filter((f) => /ECOPETROL/.test(f));
  const lines = fs.readFileSync(path.join(dir, 'acciones', 'ECOPETROL.csv'), 'utf8').trim().split('\n');
  // Un solo archivo con los dos tramos (solo los días negociados)
  assert(ecoFiles.length === 1 && lines.length === 1 + 6 && !fs.existsSync(path.join(dir, 'acciones', 'originales')), ecoFiles.join() + ' / ' + lines.length);
  // El respaldo lleva las variables macro a otro equipo
  const st2 = new Store(tmp());
  st2.importData(JSON.parse(JSON.stringify(st.exportData())));
  assert(st2.data.macro.trm.dates.length === m.trm.dates.length);
});

Promise.all(pending).then(() => {
  console.log(`${passed} pruebas correctas, ${failed} fallidas`);
  if (failed) process.exit(1);
});
