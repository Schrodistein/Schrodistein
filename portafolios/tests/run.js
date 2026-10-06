/* Pruebas sin dependencias: node portafolios/tests/run.js */
'use strict';
const path = require('path');
for (const f of ['stats', 'optim', 'model', 'sample', 'plan', 'xlsx', 'report', 'macro', 'pasos', 'frontera', 'guia', 'catalogo', 'matriz', 'macro-banrep', 'sistema', 'indices', 'biblioteca', 'riesgo', 'tes-banrep']) require(path.join(__dirname, '..', 'js', f + '.js'));
const PF = globalThis.PF;
const { dot, quad, matVec, solve } = PF.stats;
let failed = 0;
let passed = 0;
const pending = [];
function test(name, fn) {
  const fail = (e) => {
    failed++;
    console.error('✗ ' + name + '\n  ' + e.message);
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => passed++, fail));
    else passed++;
  } catch (e) {
    fail(e);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'aserción fallida');
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sumOf = (w) => w.reduce((s, x) => s + x, 0);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomProblem(R, n) {
  const A = Array.from({ length: n + 3 }, () => Array.from({ length: n }, () => R() - 0.5));
  const S = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0) / 10 + (i === j ? 0.002 : 0)));
  const mu = Array.from({ length: n }, () => 0.02 + 0.2 * R());
  return { S, mu };
}
function sampleModel(opts) {
  const d = PF.data.parseCSV(PF.sample.csv());
  const R = PF.data.toReturns(d.values, 'prices');
  const mi = PF.data.guessMarket(d.names);
  const datos = { names: d.names.filter((_, i) => i !== mi), returns: R.filter((_, i) => i !== mi), market: R[mi], marketName: d.names[mi], dates: d.dates };
  return PF.model.build(datos, Object.assign({ freq: 'mensual', rf: 0.04, muModel: 'hist', covModel: 'sample' }, opts));
}

test('regresión recupera alfa y beta exactos', () => {
  const x = [0.01, -0.02, 0.03, 0.005, -0.01, 0.02];
  const y = x.map((v) => 0.002 + 1.3 * v);
  const r = PF.stats.regress(y, x);
  assert(near(r.alpha, 0.002, 1e-12) && near(r.beta, 1.3, 1e-12) && near(r.r2, 1, 1e-12));
});

test('solve resuelve un sistema lineal', () => {
  const x = solve([[4, 1, 0], [1, 3, 1], [0, 1, 2]], [1, 2, 3]);
  const b = matVec([[4, 1, 0], [1, 3, 1], [0, 1, 2]], x);
  assert(near(b[0], 1, 1e-12) && near(b[1], 2, 1e-12) && near(b[2], 3, 1e-12));
});

test('CSV con punto y coma, coma decimal y columna de fechas', () => {
  const d = PF.data.parseCSV('Fecha;A;B;IPC\n2024-01;10,5;20;100\n2024-02;11,0;19,5;101,5\n2024-03;;1;1\n');
  assert(d.names.join('|') === 'A|B|IPC', d.names.join('|'));
  assert(d.values[0][1] === 11 && d.values[2][1] === 101.5);
  // La fila con un hueco se conserva (NaN); el modelo decide cómo usarla
  assert(d.dropped === 0 && d.dates[0] === '2024-01' && Number.isNaN(d.values[0][2]));
  assert(PF.data.guessMarket(d.names) === 2);
});

test('rendimientos en % se convierten a decimales', () => {
  const r = PF.data.toReturns([[1.5, -2, 3]], 'returns');
  assert(near(r[0][0], 0.015, 1e-12));
});

test('conjunto activo = gradiente proyectado (problemas aleatorios con límites)', () => {
  const R = rng(7);
  for (let k = 0; k < 25; k++) {
    const n = 3 + (k % 10);
    const { S, mu } = randomProblem(R, n);
    const t = [0, 0.05, 0.3, 2][k % 4];
    const c = mu.map((m) => t * m);
    const hi = Math.max(1 / n + 0.05, [0.25, 0.4, 1][k % 3]);
    const lo = k % 5 === 0 ? -0.1 : 0;
    const a = PF.optim.solveQP(S, c, lo, hi);
    const b = PF.optim.solveQPGradient(S, c, lo, hi, 30000);
    const f = (w) => 0.5 * quad(S, w) - dot(c, w);
    assert(near(sumOf(a), 1, 1e-9), 'suma de pesos ' + sumOf(a));
    assert(a.every((x) => x >= lo - 1e-9 && x <= hi + 1e-9), 'límites');
    assert(f(a) <= f(b) + 1e-9, `objetivo ${f(a)} > ${f(b)} (caso ${k})`);
  }
});

test('mínima varianza sin límites = fórmula cerrada Σ⁻¹1 / 1ᵀΣ⁻¹1', () => {
  const { S } = randomProblem(rng(3), 6);
  const x = solve(S, new Array(6).fill(1));
  const s = sumOf(x);
  const w = PF.optim.solveQP(S, new Array(6).fill(0), -10, 10);
  w.forEach((v, i) => assert(near(v, x[i] / s, 1e-8)));
});

test('tangente sin límites = fórmula cerrada Σ⁻¹(μ − rf)', () => {
  const { S, mu } = randomProblem(rng(11), 5);
  const rf = 0.01;
  const x = solve(S, mu.map((m) => m - rf));
  const s = sumOf(x);
  const w = PF.optim.maxRatio(S, mu, rf, -10, 10).w;
  w.forEach((v, i) => assert(near(v, x[i] / s, 1e-5), `peso ${i}: ${v} vs ${x[i] / s}`));
});

test('tangente con límites supera a 5000 carteras aleatorias factibles', () => {
  const R = rng(5);
  const { S, mu } = randomProblem(R, 8);
  const rf = 0.03;
  const best = PF.optim.maxRatio(S, mu, rf, 0, 0.3).w;
  const sh = (w) => (dot(mu, w) - rf) / Math.sqrt(quad(S, w));
  for (let k = 0; k < 5000; k++) {
    const w = PF.optim.projectBoxSimplex(mu.map(() => R()), new Array(8).fill(0), new Array(8).fill(0.3));
    assert(sh(w) <= sh(best) + 1e-9, 'una cartera aleatoria tiene mayor Sharpe');
  }
});

test('frontera: σ y μ crecen juntos, y es cóncava', () => {
  const { S, mu } = randomProblem(rng(9), 7);
  const f = PF.optim.frontier(S, mu, 0, 0.35);
  for (let i = 1; i < f.length; i++) {
    assert(f[i].vol >= f[i - 1].vol - 1e-9 && f[i].ret >= f[i - 1].ret - 1e-9, 'monótona');
  }
  for (let i = 1; i < f.length - 1; i++) {
    const a = f[i - 1];
    const b = f[i];
    const c = f[i + 1];
    if (c.vol - a.vol < 1e-6) continue;
    const lin = a.ret + ((c.ret - a.ret) * (b.vol - a.vol)) / (c.vol - a.vol);
    assert(b.ret >= lin - 1e-6, 'cóncava en el punto ' + i);
  }
});

test('paridad de riesgo: contribuciones iguales', () => {
  const { S } = randomProblem(rng(13), 6);
  const w = PF.optim.riskParity(S);
  const Sw = matVec(S, w);
  const rc = w.map((x, i) => x * Sw[i]);
  const avg = sumOf(rc) / 6;
  rc.forEach((r) => assert(near(r, avg, 1e-8 * Math.abs(avg) + 1e-14)));
});

test('modelo de ejemplo: medidas de Sharpe, Treynor y Jensen coherentes', () => {
  const m = sampleModel();
  assert(m.assets.length === 10 && m.T === 60);
  for (const a of m.assets) {
    assert(near(a.sharpe, (a.expRet - m.rf) / a.vol, 1e-12));
    assert(near(a.jensen, a.expRet - (m.rf + a.beta * (m.Em - m.rf)), 1e-12));
    // Con μ histórica, el alfa de Jensen ex ante coincide con el de la regresión
    assert(near(a.jensen, a.alphaHist, 1e-9), a.name);
  }
});

test('con μ del CAPM todos los alfas son cero', () => {
  const m = sampleModel({ muModel: 'capm' });
  m.assets.forEach((a) => assert(near(a.jensen, 0, 1e-12)));
  assert(!PF.model.treynorBlack(m).ok);
});

test('carteras de referencia respetan límites y ordenan bien', () => {
  const m = sampleModel();
  const P = PF.model.portfolios(m, 0, 0.2);
  for (const k of ['minVar', 'tangency', 'maxDiv', 'equal']) {
    const w = P[k].w;
    assert(near(sumOf(w), 1, 1e-8) && w.every((x) => x >= -1e-9 && x <= 0.2 + 1e-9), k);
  }
  for (const k of ['maxDiv', 'equal']) assert(P.minVar.vol <= P[k].vol + 1e-9, 'mínima varianza ' + k);
  for (const k of ['minVar', 'maxDiv', 'equal']) assert(P.tangency.sharpe >= P[k].sharpe - 1e-9, 'Sharpe ' + k);
  for (const k of ['minVar', 'tangency', 'equal']) assert(P.maxDiv.divRatio >= P[k].divRatio - 1e-6, 'diversificación ' + k);
  assert(P.tangency.effN >= 5 - 1e-9, 'con tope de 20 % hay al menos 5 activos efectivos');
});

test('confirmación: la tangente es eficiente y 1/N no', () => {
  const m = sampleModel();
  const P = PF.model.portfolios(m, 0, 0.2);
  const c1 = PF.model.confirm(m, P.tangency.w, 0, P.cap);
  assert(c1.verdict === 'eficiente', 'tangente: ' + c1.verdict + ' ' + c1.retGap);
  const c2 = PF.model.confirm(m, P.equal.w, 0, P.cap);
  assert(c2.verdict === 'ineficiente' && c2.retGap > 0.01 && c2.volGap > 0);
  assert(near(c2.sameRisk.vol, c2.me.vol, 1e-6), 'misma volatilidad');
  assert(near(c2.sameRet.ret, c2.me.ret, 1e-6), 'mismo rendimiento');
});

test('Treynor-Black: Sharpe² = Sharpe_M² + razón de información²', () => {
  const m = sampleModel();
  const tb = PF.model.treynorBlack(m);
  assert(tb.ok);
  assert(near(sumOf(tb.wA), 1, 1e-9));
  // Verificación directa con índice + cartera activa
  const retP = tb.wIndex * m.Em + tb.wActive * (m.rf + tb.alphaA + tb.betaA * (m.Em - m.rf)) ;
  const betaP = tb.wIndex + tb.wActive * tb.betaA;
  const volP = Math.sqrt(betaP * betaP * m.mktVol * m.mktVol + tb.wActive * tb.wActive * tb.resA);
  const retEx = retP - m.rf;
  assert(near(retEx / volP, tb.sharpeP, 1e-6), `${retEx / volP} vs ${tb.sharpeP}`);
});

test('modelo de índice único: covarianza = ββᵀσ²m + diag(σ²ε)', () => {
  const m = sampleModel({ covModel: 'index' });
  const a = m.assets;
  assert(near(m.Sigma[0][1], a[0].beta * a[1].beta * m.mktVol * m.mktVol, 1e-12));
});

/* Formatos reales de descarga (encabezados y estilo numérico tal como los exporta cada sitio). */
const INVESTING_ES = '﻿"Fecha","Último","Apertura","Máximo","Mínimo","Vol.","% var."\n' +
  '"01.03.2024","2.450,00","2.400,00","2.500,00","2.380,00","120,35M","2,08%"\n' +
  '"01.02.2024","2.400,00","2.350,00","2.420,00","2.300,00","98,10M","-1,64%"\n' +
  '"01.01.2024","2.440,00","2.300,00","2.460,00","2.290,00","110,00M","5,17%"\n' +
  '"01.12.2023","2.320,00","2.250,00","2.330,00","2.240,00","90,00M","1,00%"\n';
const INVESTING_EN = '"Date","Price","Open","High","Low","Vol.","Change %"\n' +
  '"03/01/2024","1,321.50","1,300.00","1,330.00","1,290.00","","1.20%"\n' +
  '"02/01/2024","1,305.80","1,280.00","1,310.00","1,270.00","","2.00%"\n' +
  '"01/01/2024","1,280.20","1,250.00","1,290.00","1,240.00","","-0.50%"\n' +
  '"12/01/2023","1,286.60","1,260.00","1,300.00","1,250.00","","3.00%"\n';
const YAHOO = 'Date,Open,High,Low,Close,Adj Close,Volume\n' +
  '2023-12-28,30000,30500,29900,30200,29000.5,1000\n2023-12-29,30200,30400,30100,30300,29100.5,900\n' +
  '2024-01-31,31000,31500,30900,31200,30000.25,800\n2024-02-29,null,null,null,null,null,null\n' +
  '2024-02-28,31500,31600,31000,31100,29900,700\n2024-03-28,32000,32500,31800,32400,31150,650\n';

test('Investing.com en español: coma decimal y fechas día.mes.año', () => {
  assert(PF.data.isSingleAsset(INVESTING_ES));
  const s = PF.data.parseSeriesFile(INVESTING_ES, 'ECOPETROL Datos históricos.csv');
  assert(s.name === 'ECOPETROL', s.name);
  assert(s.column === 'Último');
  assert(s.dates.join() === '2023-12-01,2024-01-01,2024-02-01,2024-03-01', s.dates.join());
  assert(s.prices[0] === 2320 && s.prices[3] === 2450, s.prices.join());
});

test('Investing.com en inglés: separador de miles y fechas mes/día/año', () => {
  const s = PF.data.parseSeriesFile(INVESTING_EN, 'MSCI COLCAP Historical Data.csv');
  assert(s.name === 'MSCI COLCAP');
  assert(s.dates[0] === '2023-12-01' && s.dates[3] === '2024-03-01', s.dates.join());
  assert(s.prices[0] === 1286.6 && s.prices[3] === 1321.5);
});

test('Yahoo Finance: usa el cierre ajustado y omite filas null', () => {
  const s = PF.data.parseSeriesFile(YAHOO, 'PFBCOLOM.CL.csv');
  assert(s.name === 'PFBCOLOM' && s.column === 'Adj Close');
  assert(s.prices.length === 5 && s.prices[0] === 29000.5);
});

test('unión de historiales: último cierre del mes y meses comunes', () => {
  const a = PF.data.parseSeriesFile(INVESTING_ES, 'ECOPETROL.csv');
  const b = PF.data.parseSeriesFile(INVESTING_EN, 'MSCI COLCAP.csv');
  const c = PF.data.parseSeriesFile(YAHOO, 'PFBCOLOM.CL.csv');
  const m = PF.data.mergeSeries([a, c, b], 'mensual');
  assert(m.names.join('|') === 'ECOPETROL|PFBCOLOM|MSCI COLCAP');
  assert(m.dates.length === 4, m.dates.join());
  assert(m.values[1][0] === 29100.5, 'diciembre toma el último día: ' + m.values[1][0]);
  assert(m.values[1][2] === 29900, 'febrero ignora la fila null');
  assert(PF.data.guessMarket(m.names) === 2);
  const again = PF.data.parseCSV(PF.data.toCSV(m));
  assert(again.names.join('|') === m.names.join('|') && again.values[2][3] === 1321.5);
});

test('claves de periodo semanal, trimestral y anual', () => {
  assert(PF.data.periodKey('2024-09-25', 'semanal') === '2024-09-23');
  assert(PF.data.periodKey('2024-09-29', 'semanal') === '2024-09-23');
  assert(PF.data.periodKey('2024-05-02', 'trimestral') === '2024-T2');
  assert(PF.data.periodKey('2024-05-02', 'anual') === '2024');
});


test('BVC: títulos encima, nemotécnico, fechas de Excel y tramos de 6 meses', () => {
  const rows1 = [
    ['Bolsa de Valores de Colombia'], ['Histórico de precios'], [],
    ['Nemotécnico', 'Fecha', 'Cantidad', 'Volumen', 'Precio de cierre'],
    ['ECOPETROL', new Date(2024, 0, 31), 1000, 2400000, 2400],
    ['ECOPETROL', 45352, 1000, 2450000, 2450], // número de serie de Excel: 2024-03-01
    ['ECOPETROL', '28/02/2024', 1000, 2420000, '2.420,50'],
  ];
  const rows2 = [
    ['Nemotécnico', 'Fecha', 'Cantidad', 'Volumen', 'Precio de cierre'],
    ['ECOPETROL', '30/04/2024', 1, 1, 2500],
    ['ECOPETROL', '31/05/2024', 1, 1, 2550],
  ];
  const a = PF.data.seriesFromRows(rows1, 'descarga (1).xlsx');
  const b = PF.data.seriesFromRows(rows2, 'descarga (2).xlsx');
  assert(a.length === 1 && a[0].name === 'ECOPETROL' && a[0].column === 'Precio de cierre');
  assert(a[0].dates.join() === '2024-01-31,2024-02-28,2024-03-01', a[0].dates.join());
  assert(a[0].prices[1] === 2420.5);
  const c = PF.data.combineSeries(a.concat(b));
  assert(c.length === 1 && c[0].parts === 2 && c[0].dates.length === 5);
});

test('BVC: un archivo con varios nemotécnicos se separa por activo', () => {
  const text = 'Nemotécnico;Fecha;Cantidad;Volumen;Precio de cierre\n' +
    'ISA;02/01/2024;10;100;18.000,00\nPFBCOLOM;02/01/2024;10;100;31.000,00\n' +
    'ISA;03/01/2024;10;100;18.100,00\nPFBCOLOM;03/01/2024;10;100;31.500,00\n';
  assert(PF.data.isSingleAsset(text));
  const s = PF.data.parseSeriesText(text, 'x.csv');
  assert(s.map((x) => x.name).join() === 'ISA,PFBCOLOM');
  assert(s[1].prices[1] === 31500 && s[0].dates[1] === '2024-01-03');
});

test('una tabla con un activo por columna no se confunde con un historial', () => {
  assert(!PF.data.isSingleAsset(PF.sample.csv()));
});


test('BVC real: CSV con punto y coma, miles con coma, días sin negociación y festivos vacíos', () => {
  const text = '﻿Fecha;Nemotécnico;Precio cierre;Precio máximo;Precio promedio ponderado;Precio mínimo;Variación absoluta;Variación porcentual;Cantidad;Volumen\r\n' +
    '2025-05-12;CIBEST;50,000.00;;;;;;;\r\n' +
    '2025-05-19;CIBEST;52,500.00;52,500.00;52,060.75;51,320.00;1,200.00;2.34;54,946.00;2,860,529,780.00\r\n' +
    '2025-05-20;CIBEST;52,620.00;55,000.00;53,025.04;52,620.00;120.00;0.23;69,642.00;3,692,769,540.00\r\n' +
    '2025-05-21;CIBEST;;;;;;;;\r\n' +
    '2025-05-22;CIBEST;51,580.00;52,000.00;51,403.46;51,060.00;-320.00;-0.6;10.00;100.00\r\n';
  const r = PF.data.readText(text, 'e1f2a3b4-CIBEST_20260908_051648.csv');
  const s = r.series[0];
  assert(r.layout === 'largo' && s.name === 'CIBEST' && s.column === 'Precio cierre');
  assert(s.dates.join() === '2025-05-19,2025-05-20,2025-05-22', s.dates.join());
  assert(s.prices[0] === 52500 && s.noTrade === 1);
});

test('BVC real: índice con «Valor hoy» y el nombre del archivo sin sufijos', () => {
  const text = '﻿Fecha;Valor hoy;Valor ayer;Variación absoluta;Variación porcentual;Variación 12 meses;Variación año\n' +
    '2024/09/16;1,317.98;1,311.68;6.30;0.48%;19.81;10.27\n2024/09/17;1,313.35;1,317.98;-4.63;-0.35%;18.88;9.88\n';
  const a = PF.data.readText(text, 'MSCI_COLCAP_20260915_3.5.csv').series[0];
  const b = PF.data.readText(text, 'MSCI_COLCAP_20260915.csv').series[0];
  assert(a.name === 'MSCI COLCAP' && b.name === 'MSCI COLCAP', a.name);
  assert(a.column === 'Valor hoy' && a.prices[0] === 1317.98 && a.dates[0] === '2024-09-16');
  assert(PF.data.isMarketName(a.name));
});

test('tabla ancha: dos filas de encabezado, columna ITEM, huecos y fechas descendentes', () => {
  const rows = [
    ['ITEM', 'FECHA', 'MSCI COLCAP', 'PRECIO MAXIMO', ''],
    ['', '', '', 'ECOPETROL', 'CIBEST'],
    [1, new Date(2026, 7, 21), 1210.37, 107.5, 53.2],
    [2, new Date(2026, 7, 20), 1198.62, 98, 51.7],
    [3, new Date(2026, 7, 19), 1225.04, 103.4, 50.9],
    [4, new Date(2026, 7, 18), '', 101, ''],
    ['', 'RENDIMIENTO ESPERADO', 0.1, 0.2, 0.3],
  ];
  const r = PF.data.readRows(rows, 'libro.xlsx');
  assert(r.layout === 'ancho' && !r.returnsLike);
  assert(r.series.map((x) => x.name).join() === 'MSCI COLCAP,ECOPETROL,CIBEST', r.series.map((x) => x.name).join());
  const e = r.series[1];
  assert(e.dates.join() === '2026-08-18,2026-08-19,2026-08-20,2026-08-21' && e.prices[0] === 101);
  const ret = PF.data.readRows([['FECHA', 'A', 'B'], ['2024-01-02', 0.01, -0.02], ['2024-01-03', 0.02, 0.01], ['2024-01-04', -0.01, 0]], 'r.csv');
  assert(ret.returnsLike, 'una hoja de rendimientos se reconoce como tal');
});

test('unión con historias de distinta longitud: huecos NaN, promedio o último del periodo', () => {
  const a = { name: 'A', dates: ['2024-01-10', '2024-01-31', '2024-02-15', '2024-02-28', '2024-03-29'], prices: [10, 12, 13, 15, 16] };
  const b = { name: 'B', dates: ['2024-02-01', '2024-02-29', '2024-03-28'], prices: [100, 110, 120] };
  const c = { name: 'C', dates: ['2024-01-31', '2024-02-29', '2024-03-29'], prices: [5, 6, 7] };
  const last = PF.data.mergeSeries([a, b, c], 'mensual', { agg: 'last' });
  assert(last.dates.length === 3 && last.common === 2, JSON.stringify(last));
  assert(Number.isNaN(last.values[1][0]) && last.values[0][1] === 15);
  const avg = PF.data.mergeSeries([a, b, c], 'mensual', { agg: 'avg' });
  assert(avg.values[0][0] === 11 && avg.values[0][1] === 14 && avg.values[1][1] === 105);
  const csv = PF.data.toCSV(last);
  const back = PF.data.parseCSV(csv);
  assert(back.dates.length === 3 && Number.isNaN(back.values[1][0]), csv);
});

test('detección de una serie corrida en el tiempo', () => {
  const R = rng(21);
  const dates = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  while (dates.length < 300) {
    if (d.getUTCDay() % 6) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const f = dates.map(() => (R() - 0.5) * 0.04);
  const mk = (name, lag, noise) => {
    let p = 100;
    const prices = dates.map((_, t) => (p *= Math.exp((f[t - lag] ?? 0) + (R() - 0.5) * noise)));
    return { name, dates, prices };
  };
  const list = [mk('A', 0, 0.01), mk('B', 0, 0.01), mk('C', 0, 0.01), mk('D', 7, 0.01)];
  const lags = PF.data.detectLags(list);
  assert(lags.length === 1 && lags[0].name === 'D' && Math.abs(lags[0].lag) === 7, JSON.stringify(lags));
});

test('correlación por pares corregida a una matriz válida', () => {
  const C = [[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]];
  const { R, fixed } = PF.stats.nearestCorr(C);
  assert(fixed && R.every((r, i) => near(r[i], 1, 1e-9)));
  assert(Math.min(...PF.stats.eigSym(R).values) > -1e-9);
});

test('modelo con toda la historia de cada activo frente a solo periodos comunes', () => {
  const d = PF.data.parseCSV(PF.sample.csv());
  const R = PF.data.toReturns(d.values, 'prices', true);
  const mi = PF.data.guessMarket(d.names);
  // El primer activo pierde sus primeros 30 meses
  const rets = R.filter((_, i) => i !== mi).map((r, i) => (i === 0 ? r.map((x, t) => (t < 30 ? NaN : x)) : r));
  const datos = { names: d.names.filter((_, i) => i !== mi), returns: rets, market: R[mi], marketName: d.names[mi], dates: d.dates };
  const all = PF.model.build(datos, { freq: 'mensual', rf: 0.04, muModel: 'hist', covModel: 'sample', history: 'all' });
  const com = PF.model.build(datos, { freq: 'mensual', rf: 0.04, muModel: 'hist', covModel: 'sample', history: 'common' });
  assert(all.info.counts[1] === 60 && all.info.counts[0] === 30 && com.T === 30);
  assert(near(all.assets[1].histRet, PF.stats.mean(R.filter((_, i) => i !== mi)[1]) * 12, 1e-12), 'usa los 60 meses del segundo activo');
  assert(Math.min(...PF.stats.eigSym(all.Sigma).values) > 0);
  const P = PF.model.portfolios(all, 0, 0.3);
  assert(P.tangency && near(sumOf(P.tangency.w), 1, 1e-8));
});


test('precio de compra: cierre del día, o el último cierre anterior', () => {
  const dates = ['2026-08-13', '2026-08-14', '2026-08-18', '2026-08-19'];
  const prices = [100, 101, 103, 104];
  const a = PF.data.priceOn(dates, prices, '2026-08-14');
  assert(a.price === 101 && a.exact && a.date === '2026-08-14');
  const b = PF.data.priceOn(dates, prices, '2026-08-17'); // festivo
  assert(b.price === 101 && !b.exact && b.date === '2026-08-14');
  const c = PF.data.priceOn(dates, prices, '2026-09-01');
  assert(c.price === 104 && c.after);
  assert(PF.data.priceOn(dates, prices, '2026-01-01').error);
  assert(PF.data.priceOn(dates, prices, '').error);
  assert(PF.data.priceOn(['2024-01', '2024-02'], [5, 6], '2024-02-15').price === 6);
});


test('plan de compra: acciones enteras, nunca pasa del presupuesto, descarta lo que no alcanza', () => {
  const items = [{ name: 'A', w: 0.5, price: 2700 }, { name: 'B', w: 0.3, price: 48000 }, { name: 'C', w: 0.2, price: 90000 }];
  const p = PF.plan.integerPlan(items, 1e6, 15000);
  assert(p.k === 3 && p.buyFees === 45000 && p.sellFees === 45000);
  assert(p.rows.every((r) => Number.isInteger(r.shares) && r.shares > 0));
  assert(p.invested + p.buyFees + p.cash === 1e6 && p.cash >= 0 && p.cash < 48400, 'sobrante ' + p.cash);
  const small = PF.plan.integerPlan(items, 100000, 15000);
  assert(small.k === 1 && small.rows[0].name === 'A', 'con $100.000 solo alcanza para A: ' + JSON.stringify(small.rows));
  const none = PF.plan.integerPlan(items, 10000, 15000);
  assert(!none.rows.length && none.error);
});

test('plan recomendado: con poco presupuesto las comisiones llevan a menos activos', () => {
  const m = sampleModel();
  const P = PF.model.portfolios(m, 0, 0.3);
  const prices = m.names.map((_, i) => [3000, 20000, 9000, 1500, 60000, 4000, 25000, 12000, 100, 180000][i]);
  const big = PF.plan.recommend(m, P.tangency.w, prices, 5e8, 15000, { hi: 0.3 });
  const small = PF.plan.recommend(m, P.tangency.w, prices, 1.5e6, 15000, { hi: 0.3 });
  assert(big.best.plan.k >= small.best.plan.k && small.best.plan.k < big.full.plan.k, `${big.best.plan.k} vs ${small.best.plan.k}`);
  const ev = small.best.ev;
  const pl = small.best.plan;
  assert(near(ev.netRet, (pl.invested * ev.e.ret - pl.buyFees - pl.sellFees) / pl.budget, 1e-12));
  assert(near(ev.breakEven, (pl.buyFees + pl.sellFees) / pl.invested, 1e-12));
  assert(small.tries.every((t) => !t.eligible || t.score <= small.best.score + 1e-12), 'elige el mejor Sharpe neto por comisiones');
  assert(big.best === big.full, 'con presupuesto grande se queda con todos los activos');
});

test('xlsx: ZIP válido con CRC32 correcto y las partes de Office Open', () => {
  assert(PF.xlsx.crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
  assert(PF.xlsx.colName(0) === 'A' && PF.xlsx.colName(25) === 'Z' && PF.xlsx.colName(26) === 'AA' && PF.xlsx.colName(701) === 'ZZ');
  const bytes = PF.xlsx.build([{ name: 'Hoja', rows: [['texto & <signos>', 1.5, { f: 'B1*2', v: 3, s: 'num4' }, { f: 'IF(1>2,1,"")', v: '' }]], freeze: { row: 1 } }]);
  assert(bytes[0] === 0x50 && bytes[1] === 0x4b);
  const txt = new TextDecoder('latin1').decode(bytes);
  for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert(txt.includes(part), part);
  assert(txt.includes('<f>B1*2</f><v>3</v>') && txt.includes('texto &amp; &lt;signos&gt;') && txt.includes('fullCalcOnLoad'));
});

test('libro de cálculos: hojas, fórmulas y resultados iguales a los de la app', () => {
  const m = sampleModel({ muModel: 'mix' });
  const P = PF.model.portfolios(m, 0, 0.3);
  const table = PF.data.parseCSV(PF.sample.csv());
  const rep = PF.report.build({ m, P, table, marketIdx: PF.data.guessMarket(table.names), s: { freq: 'mensual', retType: 'simple', agg: 'last', history: 'all', muModel: 'mix', covModel: 'sample', wmin: 0, wmax: 0.3 } });
  const names = rep.sheets.map((x) => x.name).join();
  assert(names === 'Resumen,Precios,Rendimientos,Estadisticas,Desviaciones,Covarianza,Correlacion,Portafolios,Frontera,Formulas', names);
  const cells = (sheet) => rep.sheets.find((x) => x.name === sheet).rows.flat().filter((c) => c && c.f);
  assert(cells('Estadisticas').some((c) => /^SLOPE\(Rendimientos!\$C\$3:\$C\$62,Rendimientos!\$B\$3:\$B\$62\)$/.test(c.f)), 'beta con PENDIENTE');
  assert(cells('Covarianza').some((c) => /CORREL|Correlacion!/.test(c.f)));
  const port = rep.sheets.find((x) => x.name === 'Portafolios').rows;
  const eRow = port.find((r) => r && r[0] === 'Rendimiento esperado E(Rp)');
  assert(eRow && near(eRow[1].v, P.recommended.ret, 1e-12) && /^SUMPRODUCT/.test(eRow[1].f));
  const bytes = rep.bytes();
  assert(bytes.length > 50000 && bytes[0] === 0x50);
});


test('recomendado: máximo rendimiento eficiente que conserva la diversificación', () => {
  const m = sampleModel({ muModel: 'mix' });
  const n = m.mu.length;
  let prevTarget = Infinity;
  for (const div of ['alta', 'media', 'baja']) {
    const target = Math.max(1, PF.model.DIV_LEVELS[div].frac * n);
    assert(target < prevTarget);
    prevTarget = target;
    const P = PF.model.portfolios(m, 0, 1, { div });
    const r = P.recommended;
    assert(near(sumOf(r.w), 1, 1e-8), 'suma 1');
    assert(r.effN >= target - 1e-6, div + ': N efectivo ' + r.effN + ' < ' + target);
    assert(Math.max(...r.w) <= P.cap + 1e-9 && P.hi.every((h) => h === P.cap), div + ': tope común a todos los portafolios');
    // Eficiente sobre la frontera que se dibuja y se confirma
    const f = PF.optim.frontier(m.Sigma, m.mu, P.lo, P.hi);
    assert(PF.optim.frontierAtRet(m.Sigma, m.mu, P.lo, P.hi, f, r.ret).vol >= r.vol - 1e-6, div + ': sobre la frontera');
    assert(PF.model.confirm(m, r.w, 0, P.cap, 0.001).verdict === 'eficiente', div + ': la confirmación lo da por eficiente');
    // Máximo: ningún punto de esa frontera con la misma diversificación rinde más
    for (const p of f) if (1 / p.w.reduce((a, x) => a + x * x, 0) >= target) assert(p.ret <= r.ret + 1e-7, div + ': hay un punto eficiente más rentable');
    // El tope es el más holgado posible: con 5 puntos más, la frontera ya no alcanza N*
    if (P.cap < 1) {
      const hi2 = new Array(n).fill(Math.min(1, P.cap + 0.05));
      const f2 = PF.optim.frontier(m.Sigma, m.mu, P.lo, hi2, { points: 80 });
      assert(f2.every((p) => 1 / p.w.reduce((a, x) => a + x * x, 0) < target + 0.05), div + ': había un tope más holgado');
    }
  }
  // Sin tope fijo: con 5 activos el recomendado no queda en 20 % cada uno
  const d = PF.data.parseCSV(PF.sample.csv());
  const R = PF.data.toReturns(d.values, 'prices', true);
  const mi = PF.data.guessMarket(d.names);
  const keep = d.names.map((_, i) => i).filter((i) => i !== mi).slice(0, 5);
  const m5 = PF.model.build({ names: keep.map((i) => d.names[i]), returns: keep.map((i) => R[i]), market: R[mi], marketName: d.names[mi], dates: d.dates }, { freq: 'mensual', rf: 0.04, muModel: 'mix', covModel: 'sample', history: 'all' });
  const r5 = PF.model.portfolios(m5, 0, 1, { div: 'media' });
  assert(Math.max(...r5.recommended.w) > 0.25, 'algún activo pesa más de 20 %');
  assert(r5.recommended.ret > r5.equal.ret, 'rinde más que pesos iguales');
  // Un tope del usuario se respeta
  const capped = PF.model.portfolios(m, 0, 0.3, { div: 'baja' });
  assert(capped.cap <= 0.3 + 1e-12 && Math.max(...capped.recommended.w) <= 0.3 + 1e-9);
});

test('renta fija, divisas y derivados: tasas, índice de rendimiento total y tipo', () => {
  const tes = 'Fecha;Nemotécnico;Tasa de negociación;Precio limpio;Cantidad\n2026-01-02;TFIT16240728;10.500;98,500.000;1,000\n2026-01-05;TFIT16240728;10.600;98,100.000;1,000\n2026-01-06;TFIT16240728;10.400;98,900.000;1,000';
  const s = PF.data.combineSeries(PF.data.readText(tes, 'tes.csv').series)[0];
  assert(s.kind === 'tasa' && s.cls === 'tes' && s.dur === 6, `${s.kind} ${s.cls} ${s.dur}`);
  assert(near(s.rates[0], 0.105, 1e-12) && near(s.rates[1], 0.106, 1e-12), 'tasas en decimal: ' + s.rates);
  // Rₜ = (1 + yₜ₋₁)^Δt − 1 − D/(1 + yₜ₋₁)·Δy
  const r1 = Math.pow(1.105, 3 / 365) - 1 - (6 / 1.105) * 0.001;
  assert(near(s.prices[1], 100 * (1 + r1), 1e-9), 'índice ' + s.prices[1]);
  assert(s.prices[2] > s.prices[1], 'si la tasa baja, el precio sube');
  // Duración leída del archivo y tasa con coma decimal
  const cdt = PF.data.combineSeries(PF.data.readText('Fecha;Tasa;Duración\n2026-01-02;11,2;0,40\n2026-01-09;11,0;0,38\n2026-01-16;10,9;0,36', 'CDT 180.csv').series)[0];
  assert(cdt.cls === 'cdt' && near(cdt.rates[0], 0.112, 1e-12) && near(cdt.dur, 0.38, 1e-12), `${cdt.cls} ${cdt.rates} ${cdt.dur}`);
  // Tramos del mismo TES en archivos distintos: se unen antes de armar el índice (sin saltos)
  const a = PF.data.readText('Fecha;Nemotécnico;Tasa\n2026-01-02;TFIT1;10.5\n2026-01-05;TFIT1;10.6', 'a.csv').series;
  const b = PF.data.readText('Fecha;Nemotécnico;Tasa\n2026-01-06;TFIT1;10.4\n2026-01-07;TFIT1;10.4', 'b.csv').series;
  const j = PF.data.combineSeries(a.concat(b))[0];
  assert(j.dates.length === 4 && j.prices[0] === 100 && Math.abs(j.prices[2] / j.prices[1] - 1) < 0.02, 'unión: ' + j.prices);
  // Divisas: «TRM» y «Tasa de cambio» son precios, no tasas de interés
  const trm = PF.data.readText('Fecha;TRM\n2026-01-02;4.100,50\n2026-01-05;4.120,00\n2026-01-06;4.090,00', 'dolar.csv').series[0];
  assert(!trm.kind && trm.cls === 'divisa' && near(trm.prices[0], 4100.5, 1e-9), `${trm.kind} ${trm.cls} ${trm.prices[0]}`);
  const fut = PF.data.readText('Fecha;Nemotécnico;Precio de liquidación\n2026-01-02;FUT COLCAP;1,500.00\n2026-01-05;FUT COLCAP;1,510.00', 'f.csv').series[0];
  assert(fut.cls === 'futuro' && fut.prices[1] === 1510, fut.cls);
  const C = (n) => PF.data.classify(n);
  assert(C('MSCI COLCAP') === 'indice' && C('COLTES LP') === 'indice' && C('COLIBR') === 'indice' && C('ICOLCAP') === 'etf' && C('ECOPETROL') === 'accion' && C('OPCION CALL PFBCOLOM') === 'opcion');
  assert(PF.data.guessMarket(['ICOLCAP', 'COLTES LP', 'MSCI COLCAP', 'ECOPETROL']) === 2, 'el índice principal es el MSCI COLCAP');
});

test('índice de referencia por segmento: β, CAPM y Jensen frente a su índice; βp frente al principal', () => {
  const R = rng(11);
  const T = 120;
  const mk = Array.from({ length: T }, () => 0.01 + 0.04 * (R() - 0.5));
  const fi = Array.from({ length: T }, () => 0.006 + 0.01 * (R() - 0.5));
  const acc = mk.map((x) => 0.002 + 1.2 * x + 0.02 * (R() - 0.5));
  const acc2 = mk.map((x) => 0.001 + 0.8 * x + 0.03 * (R() - 0.5));
  const tes = fi.map((x) => 0.001 + 0.9 * x + 0.003 * (R() - 0.5));
  const datos = { names: ['ACC', 'ACC2', 'TES'], returns: [acc, acc2, tes], market: mk, marketName: 'COLCAP', dates: mk.map((_, i) => String(i)), bench: [null, null, { name: 'COLTES', returns: fi }] };
  const m = PF.model.build(datos, { freq: 'mensual', rf: 0.05, muModel: 'mix', covModel: 'sample', history: 'all' });
  const t = m.assets[2];
  const direct = PF.stats.regress(tes.map((v) => v - m.rfp), fi.map((v) => v - m.rfp));
  assert(t.bench === 'COLTES' && near(t.beta, direct.beta, 1e-12), 'β frente a COLTES');
  const Eb = PF.stats.mean(fi) * 12;
  assert(near(t.capmRet, 0.05 + t.beta * (Eb - 0.05), 1e-12) && near(t.jensen, t.expRet - (0.05 + t.beta * (Eb - 0.05)), 1e-12));
  const betaM = PF.stats.regress(tes.map((v) => v - m.rfp), mk.map((v) => v - m.rfp)).beta;
  assert(near(t.betaM, betaM, 1e-12) && m.assets[0].bench === 'COLCAP' && near(m.assets[0].beta, m.assets[0].betaM, 1e-15));
  const e = PF.model.evaluate(m, [0.3, 0.3, 0.4]);
  assert(near(e.beta, 0.3 * m.assets[0].betaM + 0.3 * m.assets[1].betaM + 0.4 * betaM, 1e-12), 'βp con β frente al principal');
});

test('plan: reparto con renta fija por horizonte, monto mínimo, montos y CDT sin comisión', () => {
  // P(pérdida) en el límite exacto de α
  const sh = PF.plan.riskyShare(0.14, 0.2, 0.09, 1, 0.1);
  assert(sh.alpha > 0 && sh.alpha < 1, 'α ' + sh.alpha);
  const mean = 0.09 + sh.alpha * 0.05;
  assert(near(PF.stats.normalCdf(-mean / (sh.alpha * 0.2)), 0.1, 1e-6), 'P(pérdida) = 10 %');
  assert(PF.plan.riskyShare(0.14, 0.2, 0.09, 5, 0.1).alpha === 1, 'a 5 años todo al portafolio');
  assert(PF.plan.riskyShare(0.14, 0.2, 0.09, 3, 0.1).alpha > sh.alpha, 'más horizonte, más riesgo');
  assert(PF.plan.riskyShare(0.05, 0.2, 0.09, 1, 0.1).alpha === 0 && PF.plan.riskyShare(0.14, 0.2, 0.09, 1, null).alpha === 1);
  assert(PF.plan.autoMin(15000, 15000, 1, 1e9) === 3e6 && PF.plan.autoMin(15000, 15000, 3, 1e9) === 1e6 && PF.plan.autoMin(15000, 15000, 1, 2e6) === 1e6 && PF.plan.autoMin(0, 0, 1, 1e6) === 0);
  const items = [
    { name: 'A', w: 0.5, price: 10000, unit: 'acciones' },
    { name: 'TES', w: 0.3, price: 0, unit: 'monto' },
    { name: 'CDT', w: 0.15, price: 0, unit: 'monto', noFee: true },
    { name: 'B', w: 0.05, price: 5000, unit: 'acciones' },
  ];
  const p = PF.plan.allocate(items, 10e6, { feeBuy: 15000, feeSell: 12000, minAmt: 1e6 });
  assert(p.rows.length === 3 && p.dropped.some((d) => d.name === 'B'), 'B no llega al mínimo');
  assert(p.rows.every((r) => r.amount >= 1e6 - 1), 'todos pasan el mínimo');
  const cdt = p.rows.find((r) => r.name === 'CDT');
  const tesR = p.rows.find((r) => r.name === 'TES');
  assert(cdt.feeBuy === 0 && cdt.feeSell === 0 && tesR.shares === null && tesR.amount % 1000 === 0);
  assert(p.buyFees === 30000 && p.sellFees === 24000 && near(p.invested + p.buyFees + p.cash, 10e6, 1e-6));
  // Plan completo: con límite de pérdida y horizonte corto, parte a renta fija segura
  const m = sampleModel();
  const P = PF.model.portfolios(m, 0, 0.3);
  const prices = m.names.map((_, i) => [3000, 20000, 9000, 1500, 60000, 4000, 25000, 12000, 100, 180000][i]);
  const r1 = PF.plan.recommend(m, P.recommended.w, prices, 5e7, { feeBuy: 15000, feeSell: 15000, years: 1, maxLoss: 0.05, safeRate: 0.09, optimizeK: false });
  const r5 = PF.plan.recommend(m, P.recommended.w, prices, 5e7, { feeBuy: 15000, feeSell: 15000, years: 5, maxLoss: 0.05, safeRate: 0.09, optimizeK: false });
  const pl = r1.best.plan;
  assert(pl.safe > 0 && r5.best.plan.safe < pl.safe, `renta fija ${pl.safe} vs ${r5.best.plan.safe}`);
  assert(near(pl.invested + pl.buyFees + pl.cash + pl.safe, 5e7, 1e-6), 'cuadra el presupuesto');
  const pj = PF.plan.project(pl, r1.best.ev.e, 0.09, 1);
  assert(near(pj.value, pl.invested * (1 + r1.best.ev.e.ret) + pl.safe * 1.09 + pl.cash - pl.sellFees, 1e-6) && near(r1.best.ev.netRet, pj.value / 5e7 - 1, 1e-12));
  // Sin comisiones (promoción), el monto mínimo automático es 0
  assert(PF.plan.recommend(m, P.recommended.w, prices, 5e6, { feeBuy: 0, feeSell: 0 }).minAmt === 0);
});

test('desfase de fechas: no se evalúan series semanales ni de tasas', () => {
  const d0 = Date.UTC(2025, 0, 1);
  const days = Array.from({ length: 200 }, (_, i) => new Date(d0 + i * 864e5).toISOString().slice(0, 10));
  const R = rng(5);
  const base = days.map(() => R() - 0.5);
  const mkS = (name, lag, noise) => {
    let v = 100;
    return { name, dates: days, prices: days.map((_, i) => (v *= Math.exp(0.01 * (base[Math.max(0, i - lag)] + noise * (R() - 0.5))))) };
  };
  const list = [mkS('A', 0, 0.3), mkS('B', 0, 0.3), mkS('C', 0, 0.3)];
  const weekly = mkS('W', 3, 0.1);
  weekly.dates = weekly.dates.filter((_, i) => i % 7 === 0);
  weekly.prices = weekly.prices.filter((_, i) => i % 7 === 0);
  assert(!PF.data.detectLags(list.concat([weekly])).some((x) => x.name === 'W'), 'la semanal no se marca');
  assert(PF.data.detectLags(list.concat([mkS('D', 5, 0.1)])).some((x) => x.name === 'D'), 'la diaria corrida sí');
});

test('días sin negociación: se repite el último precio desde la primera fecha de cada activo', () => {
  const A = { name: 'A', dates: ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'], prices: [10, 11, 12, 13, 14] };
  const B = { name: 'B', dates: ['2026-01-05', '2026-01-07', '2026-01-09'], prices: [100, 90, 95] };
  const C = { name: 'C', dates: ['2026-01-07', '2026-01-08'], prices: [50, 52] }; // empieza a cotizar después y deja de tener datos
  const D = { name: 'D', dates: A.dates, prices: [1, 2, 3, 4, 5] };
  const m = PF.data.mergeSeries([A, B, C, D], 'diaria');
  const col = (n) => m.values[m.names.indexOf(n)];
  assert(col('B').join() === '100,100,90,90,95', col('B').join());
  assert(Number.isNaN(col('C')[0]) && Number.isNaN(col('C')[1]) && col('C').slice(2).join() === '50,52,52', col('C').join());
  assert(m.filled.join() === '0,2,1,0');
  const raw = PF.data.mergeSeries([A, B, C, D], 'diaria', { fill: false });
  assert(Number.isNaN(raw.values[1][1]) && raw.filled.join() === '0,0,0,0');
});

test('paso a paso: varianza, covarianza y correlación iguales a las de la librería', () => {
  const R = rng(3);
  const a = Array.from({ length: 40 }, () => R() - 0.5);
  const b = a.map((x) => 0.6 * x + 0.3 * (R() - 0.5));
  b[5] = NaN;
  const pc = PF.pasos.pairCalc(a, b);
  const a2 = a.filter((_, i) => i !== 5);
  const b2 = b.filter((_, i) => i !== 5);
  assert(pc.n === 39 && near(pc.va, PF.stats.variance(a2), 1e-15) && near(pc.cov, PF.stats.covariance(a2, b2), 1e-15));
  assert(near(pc.corr, PF.stats.covariance(a2, b2) / Math.sqrt(PF.stats.variance(a2) * PF.stats.variance(b2)), 1e-12) && pc.corr > 0.5);
  // Damodaran: reapalancar y desapalancar son inversas (Hamada)
  assert(near(PF.pasos.relever(0.8, 0.35, 0.5), 1.06, 1e-12) && near(PF.pasos.unlever(1.06, 0.35, 0.5), 0.8, 1e-12));
  const rows = [['Date updated:', '2026-01-05'], [], ['Industry Name', 'Number of firms', 'Beta', 'D/E Ratio', 'Effective Tax rate', 'Unlevered beta', 'Cash/Firm value', 'Unlevered beta corrected for cash'],
    ['Advertising', 50, 1.1, 0.3, 0.2, 0.9, 0.05, 0.95], ['Bank (Money Center)', 80, 0.9, 1.5, 0.25, 0.5, 0.1, 0.55], ['Oil/Gas (Integrated)', 30, 1.0, 0.4, 0.3, 0.8, 0.04, 0.83], ['Power', 40, 0.7, 1.2, 0.2, 0.4, 0.02, 0.41], ['Utility (General)', 20, 0.6, 1.0, 0.2, 0.35, 0.02, 0.36], ['Total Market', 900, 1, 0.5, 0.2, 0.7, 0.05, 0.74]];
  const list = PF.pasos.parseDamodaran(rows);
  assert(list.length === 5 && list[1].unlev === 0.55, 'usa la beta corregida por caja');
  assert(PF.pasos.suggestIndustry('ECOPETROL', list).name === 'Oil/Gas (Integrated)' && PF.pasos.suggestIndustry('PFCIBEST', list).name === 'Bank (Money Center)');
  // La pantalla se arma con el modelo de ejemplo
  const m = sampleModel();
  const table = PF.data.parseCSV(PF.sample.csv());
  const html = PF.pasos.render({ m, table, kind: 'prices', retType: 'simple', P: PF.model.portfolios(m, 0, 1), esc: (x) => String(x), pct: (x) => (x * 100).toFixed(2) + '%', num: String, a: 0, b: 1, dam: { list, inputs: {} } });
  assert(/Varianza del portafolio/.test(html) && /Damodaran/.test(html) && /Markowitz \(1952\)/.test(html));
});

test('frontera paso a paso: correlación promedio implícita reproduce σp y cada portafolio se explica', () => {
  const m = sampleModel();
  const P = PF.model.portfolios(m, 0, 1);
  for (const k of ['recommended', 'tangency', 'minVar', 'equal']) {
    const w = P[k].w;
    const ac = PF.frontera.avgCorr(m, w);
    assert(near(ac.varP, P[k].vol * P[k].vol, 1e-10), 'σp² = Σwᵢ²σᵢ² + ρ̄ₚ·cruzado para ' + k);
    assert(near(ac.own + ac.weighted * ac.cross, ac.varP, 1e-12) && ac.weighted <= 1 && ac.weighted >= -1);
  }
  // Promedio simple = media de los pares de la matriz de correlaciones
  const n = m.names.length;
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += m.corr[i][j];
  assert(near(PF.frontera.avgCorr(m, P.equal.w).simple, s / ((n * (n - 1)) / 2), 1e-12));
  // Condición de primer orden del tangente: activos interiores con prima = βᵢ,T × prima de T
  const T = P.tangency;
  const bT = PF.frontera.betasTo(m, T.w);
  const diff = m.names.map((_, i) => m.mu[i] - m.rf - bT[i] * (T.ret - m.rf));
  const inner = diff.filter((_, i) => T.w[i] > P.lo[i] + 1e-3 && T.w[i] < P.hi[i] - 1e-3);
  assert(inner.length >= 1 && inner.every((x) => Math.abs(x - inner[0]) < 2e-3), 'los interiores comparten la misma diferencia ν');
  diff.forEach((x, i) => {
    if (T.w[i] <= P.lo[i] + 1e-4) assert(x <= inner[0] + 2e-3, 'en el mínimo: diferencia ≤ ν');
    if (T.w[i] >= P.hi[i] - 1e-4) assert(x >= inner[0] - 2e-3, 'en el tope: diferencia ≥ ν');
  });
  const ports = [{ key: 'recommended', label: 'Recomendado' }, { key: 'tangency', label: 'Máxima Sharpe' }, { key: 'minVar', label: 'Mínima varianza' }];
  const html = PF.frontera.render({ m, P, esc: (x) => String(x), pct: (x) => (x * 100).toFixed(2) + '%', sel: 'tangency', ports, tb: PF.model.treynorBlack(m), width: 600 });
  for (const t of ['11.1 La idea común', '11.2 Mínima varianza', '11.4 Máxima razón de Sharpe', '11.5 Recomendado', '11.7 Paridad de riesgo', '11.10 ¿Cuál elegir?', 'separación de Tobin', 'Michaud', 'frontera eficiente', 'mercado de capitales', 'mercado de valores', 'Cómo se eligen', 'Por qué un activo entra', 'Dónde queda', 'promedian las correlaciones', 'Máximo rendimiento', 'Máxima Sharpe (elegido)']) assert(html.includes(t), 'falta ' + t);
});

test('guía de la BVC y catálogo de activos', () => {
  const cat = PF.catalog;
  const nemos = cat.map((c) => c.nemo);
  assert(new Set(nemos).size === nemos.length, 'nemotécnicos repetidos');
  for (const n of ['ECOPETROL', 'PFCIBEST', 'ICOLCAP', 'MSCI COLCAP', 'COLIBR']) assert(nemos.includes(n), 'falta ' + n);
  // Solo la BVC: acciones, ETF e índices sin fuente automática; las divisas sí la tienen
  assert(cat.filter((c) => c.type !== 'divisa').every((c) => c.yahoo === '') && cat.filter((c) => c.type === 'divisa').every((c) => /=X$/.test(c.yahoo)));
  assert(PF.lib.notBvc({ name: 'ECOPETROL', source: 'Yahoo Finance' }) && PF.lib.notBvc({ name: 'ISA', source: 'BVC + Yahoo Finance' }) && !PF.lib.notBvc({ name: 'ISA', source: 'BVC' }) && !PF.lib.notBvc({ name: 'USD/COP', source: 'Yahoo Finance' }));
  const sin = PF.guia.render({});
  assert(PF.guia.CHAPTERS.length >= 10 && sin.includes('Ruta de aprendizaje') && sin.includes('Glosario') && !sin.includes('Con tus datos'));
  const m = sampleModel();
  const P = PF.model.portfolios(m, 0, 1);
  const con = PF.guia.render({ m, P, pct: (x) => (x * 100).toFixed(1) + '%', esc: String, sel: 'tangency', ports: [{ key: 'tangency', label: 'Máxima Sharpe' }] });
  assert(con.includes('Con tus datos') && con.includes('Máxima Sharpe') && /Gordon \(1959\)/.test(con) && /Tobin \(1958\)/.test(con));
});

test('matriz de precios como «M. PRECIOS»: ruedas de la BVC, último precio cuando un activo no negoció, vacío antes de cotizar', () => {
  // COLCAP negocia lun 2026-08-10 a vie 08-14 y mar 08-18 (lunes 17 festivo); NUEVA empieza a cotizar el 13
  const colcap = { name: 'MSCI COLCAP', dates: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-18'], prices: [1000, 1010, 1020, 1030, 1040, 1050] };
  const eco = { name: 'ECOPETROL', dates: ['2026-08-10', '2026-08-12', '2026-08-14', '2026-08-18'], prices: [100, 90, 110, 120] };
  const nueva = { name: 'NUEVA', dates: ['2026-08-13', '2026-08-18'], prices: [100, 101] };
  const tasa = { name: 'TES', kind: 'tasa', dates: ['2026-08-10', '2026-08-11'], prices: [0.1, 0.11] };
  const mx = PF.matriz.build([eco, nueva, colcap, tasa], { market: 'MSCI COLCAP', calendar: 'habiles' });
  assert(mx.names.join() === 'MSCI COLCAP,ECOPETROL,NUEVA', 'el índice va primero y las tasas no entran');
  assert(mx.dates.join() === '2026-08-10,2026-08-11,2026-08-12,2026-08-13,2026-08-14,2026-08-17,2026-08-18', 'días hábiles sin fines de semana: ' + mx.dates.join());
  assert(mx.values[0][5] === 1040 && mx.filled[0][5], 'festivo: se mantiene el último precio del índice');
  assert(mx.values[1].join() === '100,100,90,90,110,110,120', 'ECOPETROL: ' + mx.values[1].join());
  assert(mx.values[1][2] === 90 && !mx.filled[1][2] && mx.filled[1][1], 'los precios cotizados no cambian');
  assert(isNaN(mx.values[2][0]) && isNaN(mx.values[2][2]) && mx.values[2][3] === 100 && mx.values[2][5] === 100, 'vacío antes de la primera cotización');
  const cal = PF.matriz.build([eco, colcap], { calendar: 'calendario', market: 'MSCI COLCAP' });
  assert(!cal.dates.includes('2026-08-15') && !cal.dates.includes('2026-08-16'), 'nunca se agregan fines de semana');
  // Predeterminado: ruedas de la BVC (días en que se negoció algún activo). Sin fines de semana ni
  // festivos: la base de 242 ruedas al año con que se anualiza no cambia.
  const ru = PF.matriz.build([eco, nueva, colcap], { market: 'MSCI COLCAP' });
  assert(ru.dates.join() === '2026-08-10,2026-08-11,2026-08-12,2026-08-13,2026-08-14,2026-08-18', 'ruedas: ' + ru.dates.join());
  assert(ru.values[1].join() === '100,100,90,90,110,120' && ru.filled[1][1], 'ECOPETROL no negoció el 11: lleva el precio del 10');
  const fri = { name: 'X', dates: ['2026-08-07', '2026-08-10'], prices: [1000, 2000] };
  assert(PF.matriz.build([fri]).dates.join() === '2026-08-07,2026-08-10', 'el sábado y el domingo no se agregan');
  // Un archivo con columna «Negociación = No» no cuenta esos días como cotización
  const back = PF.data.parseSeriesText('Fecha;Nemotécnico;Precio cierre;Negociación\r\n2026-08-07;X;1.000;Sí\r\n2026-08-08;X;1.000;No (último precio)\r\n2026-08-10;X;2.000;Sí', 'X.csv')[0];
  assert(back.dates.join() === '2026-08-07,2026-08-10' && back.prices.join() === '1000,2000', 'relectura: ' + back.dates.join());
  const cut = PF.matriz.build([eco, colcap], { market: 'MSCI COLCAP', cut: '2026-08-12' });
  assert(cut.dates[cut.dates.length - 1] === '2026-08-12');
  // Hoja: encabezados como en «M. PRECIOS» y la fecha más reciente arriba
  const sh = PF.matriz.sheet(mx);
  assert(sh.rows.length === 2 + 7);
  assert(sh.name === 'M. PRECIOS' && sh.rows[0][0].v === 'ITEM' && sh.rows[0][1].v === 'FECHA' && sh.rows[0][2].v === 'MSCI COLCAP' && sh.rows[0][3].v === 'PRECIO DE CIERRE');
  assert(sh.rows[1][3].v === 'ECOPETROL' && sh.rows[1][4].v === 'NUEVA');
  assert(sh.rows[2][0] === 1 && sh.rows[2][1].v === PF.matriz.serial('2026-08-18') && sh.rows[2][1].s === 'date' && sh.rows[2][3].v === 120 && sh.rows[2][3].s === 'px');
  assert(PF.matriz.serial('2026-08-21') === 46255, 'serie de Excel');
  assert(sh.rows[sh.rows.length - 1][4] === null, 'celda vacía antes de cotizar');
  const wb = PF.matriz.workbook([eco, colcap], { market: 'MSCI COLCAP' });
  assert(wb.bytes && wb.bytes.length > 500 && wb.bytes[0] === 0x50 && wb.bytes[1] === 0x4b, 'archivo xlsx');
  if (process.env.MATRIZ_OUT) require('fs').writeFileSync(process.env.MATRIZ_OUT, Buffer.from(PF.matriz.workbook([eco, nueva, colcap], { market: 'MSCI COLCAP' }).bytes));
});

test('tramos con número de descarga: 1790829234836-COLTES LP y los demás son un solo índice', () => {
  const parts = ['1790829234836-COLTES LP.csv', '1790829249314-COLTES LP.csv', 'COLTES_LP_20260908_051610.csv'];
  const rows = [['2026/01/02', '443,97'], ['2026/07/01', '401,89'], ['2026/08/13', '411,69']];
  const list = parts.flatMap((f, i) => PF.data.parseSeriesText(`Fecha;Valor hoy\n${rows[i][0]};${rows[i][1]}\n2026/0${i + 1}/2${i};${rows[i][1]}\n`, f));
  assert(list.every((x) => x.name === 'COLTES LP'), list.map((x) => x.name).join());
  const one = PF.data.combineSeries(list);
  assert(one.length === 1 && one[0].name === 'COLTES LP' && one[0].dates.length === 6, JSON.stringify(one.map((x) => [x.name, x.dates.length])));
  // Biblioteca con tramos guardados por separado en versiones anteriores: se unen al abrir
  const now = new Date().toISOString();
  const mk = (name, d, p) => PF.lib.mergeRecord(null, { name, dates: d, prices: p }, 'BVC', now).rec;
  const g = PF.lib.mergeGroups([mk('1790829234836-COLTES LP', ['2026-01-02', '2026-01-05'], [443.97, 444]), mk('1790829249314-COLTES LP', ['2026-07-01', '2026-07-02'], [401.89, 396.49]), mk('ECOPETROL', ['2026-01-02', '2026-01-05'], [10, 11])], now);
  assert(g.puts.length === 1 && g.dels.length === 2 && g.puts[0].name === 'COLTES LP', JSON.stringify(g.dels));
  assert(g.puts[0].dates.join() === '2026-01-02,2026-01-05,2026-07-01,2026-07-02' && g.puts[0].prices.join() === '443.97,444,401.89,396.49', 'mismos valores de cada tramo');
});

test('macro: boletín del DANE en PDF (texto), Excel con trimestres y meses, y enlaces oficiales', () => {
  const pib = 'Boletín técnico Producto Interno Bruto (PIB) II trimestre 2025pr. En el segundo trimestre de 2025pr, el Producto Interno Bruto, en su serie original, crece 2,1% respecto al mismo periodo de 2024pr. En el primer trimestre de 2025 el PIB decrece 0,4% frente al trimestre anterior.';
  const f = PF.macro.parsePdfText(pib, 'pib');
  assert(f.length === 2 && f[1].date === '2025-06-28' && f[1].value === 2.1 && f[0].date === '2025-03-28' && f[0].value === -0.4, JSON.stringify(f));
  const ipc = 'En septiembre de 2025, la variación anual del IPC fue 5,18%, y la mensual 0,32%.';
  const g = PF.macro.parsePdfText(ipc, 'inflacion');
  assert(g.length === 1 && g[0].date === '2025-09-28' && g[0].value === 5.18, JSON.stringify(g));
  const des = 'En agosto de 2025 la tasa de desempleo en el total nacional fue 8,6%.';
  assert(PF.macro.parsePdfText(des, 'desempleo')[0].value === 8.6);
  // Excel con títulos arriba, trimestres «2024-I» y valores con coma decimal
  const rows = [['DANE · Cuentas nacionales'], ['Periodo', 'Variación anual (%)'], ['2024-I', '0,7'], ['2024-II', '2,1'], ['2024-III', 2.0], ['2024-IV', '2,3'], ['Fuente: DANE']];
  const r = PF.macro.parseRows(rows, 'pib.xlsx');
  assert(r.dates.join() === '2024-03-28,2024-06-28,2024-09-28,2024-12-28' && r.values.join() === '0.7,2.1,2,2.3', JSON.stringify(r));
  const m = PF.macro.parseRows([['Mes', 'TD'], ['ene-25', 11.6], ['feb-25', 10.3], ['mar-25', 9.6]], 'td.xlsx');
  assert(m.dates[0] === '2025-01-28' && m.values[2] === 9.6);
  const serial = PF.macro.parseRows([[45658, 4400.5], [45659, 4410], [45660, 4395.25]], 'trm.xlsx');
  assert(serial.dates[0] === '2025-01-01' && serial.values[1] === 4410, JSON.stringify(serial));
  for (const k of ['pib', 'inflacion', 'desempleo', 'trm']) assert(PF.macro.OFFICIAL[k].length >= 1 && PF.macro.OFFICIAL[k].every(([, u]) => /^https:\/\/www\.(dane|banrep|datos)\.gov\.co\//.test(u)), k);
});

test('series del Banco de la República: elige la serie por su nombre, PIB en niveles → crecimiento anual, ITCR no es TRM', () => {
  const nb = (x) => x.replace(/ /g, '\u00a0');
  // Formato largo (desempleo): fechas de Excel en la primera columna, una columna por serie
  const largo = [[nb('Datos del Grupo Serie: Mercado laboral')], [null, 'Serie'], [null, nb('Tasa Global de participación - 13 áreas'), nb('Tasa de desempleo - 13 áreas'), nb('Tasa de desempleo - Total Nacional')], [45688, 65.1, 9.9, 11.6], [45716, 65.3, 9.1, 10.3], [45747, '.', 8.9, 9.6], [nb('Los valores ausentes se indican con un punto (.)')]];
  const d = PF.macro.parseBanrep(largo, 'desempleo', 'x.xlsx');
  assert(d && d.label === 'Tasa de desempleo - Total Nacional' && d.values.join() === '11.6,10.3,9.6' && d.dates[0] === '2025-01-31', JSON.stringify(d));
  // Formato ancho (PIB): fechas en una fila, series en filas; niveles → crecimiento anual
  const fechas = ['31/03/2024', '30/06/2024', '30/09/2024', '31/12/2024', '31/03/2025', '30/06/2025'];
  const ancho = [['Datos del Grupo Serie: PIB'], [null].concat(fechas), ['Serie'], ['1. PIB reportado', 200000, 201000, 202000, 203000, 204000, 205020], ['1.01. Demanda Interna', 1, 2, 3, 4, 5, 6]];
  const p = PF.macro.parseBanrep(ancho, 'pib', 'pib.xlsx');
  assert(p && p.dates.join() === '2025-03-31,2025-06-30' && Math.abs(p.values[0] - 2) < 1e-9 && Math.abs(p.values[1] - 2) < 1e-9, JSON.stringify(p));
  // Un archivo de índices de tasa de cambio real no se toma como TRM
  const itcr = [[null, 'Serie'], [null, nb('Índice de tasa de cambio real FMI'), nb('Índice de tasa de cambio real IPC NT')], [45688, 104.5, 95.1], [45716, 104.6, 95.2], [45747, 104.7, 95.3]];
  assert(PF.macro.parseBanrep(itcr, 'trm', 'TRM.xlsx') === null);
  // Las series incluidas en la app
  const B = PF.macroBanrep;
  assert(B && ['inflacion', 'pib', 'desempleo'].every((k) => B.series[k].dates.length === B.series[k].values.length && B.series[k].dates.length > 50 && /^Banco de la República/.test(B.series[k].source)));
});

test('CSV para Excel en español: punto de miles, coma decimal y se vuelve a leer igual', () => {
  const X = PF.data.excelNum;
  assert(X(2400) === '2.400' && X(2400.5) === '2.400,5' && X(1234567.891) === '1.234.567,891' && X(-0.0525) === '-0,0525' && X(10.500000000000002) === '10,5' && X(NaN) === '' && X(999) === '999');
  // Archivo exportado por la biblioteca → mismo historial, con cantidad y volumen
  const dates = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'];
  const px = [2400, 2410.5, 1999.75, 12345.5];
  const q = [1200000, 35, 1500, 2000000];
  const v = [2880000000.5, 84367.5, 2999625, 24691000000];
  const text = '\ufeffFecha;Nemotécnico;Precio cierre;Cantidad;Volumen\r\n' + dates.map((d, i) => `${d};ECOPETROL;${X(px[i])};${X(q[i])};${X(v[i])}`).join('\r\n');
  const s = PF.data.parseSeriesText(text, 'ECOPETROL.csv')[0];
  assert(s.dates.join() === dates.join() && s.prices.join() === px.join(), 'precios: ' + s.prices.join());
  assert(s.qty.join() === q.join() && s.vol.join() === v.join(), 'cantidad y volumen: ' + s.qty.join() + ' / ' + s.vol.join());
  // Y el formato de la BVC (coma de miles, punto decimal) sigue leyéndose igual
  const bvc = 'Fecha,Nemotécnico,Precio cierre,Cantidad,Volumen\n' + dates.map((d, i) => `${d},ECOPETROL,"${px[i].toLocaleString('en-US')}","${q[i].toLocaleString('en-US')}","${v[i].toLocaleString('en-US', { maximumFractionDigits: 2 })}"`).join('\n');
  const b = PF.data.parseSeriesText(bvc, 'ECOPETROL.csv')[0];
  assert(b.prices.join() === px.join() && b.qty.join() === q.join(), 'BVC: ' + b.prices.join() + ' / ' + b.qty.join());
  // Variables macro exportadas → se vuelven a importar igual
  const mac = PF.macro.toCSV({ trm: { dates: ['2026-01-02', '2026-01-03', '2026-01-04'], values: [4230.25, 4199.5, 4301], source: 'x' } });
  const back = PF.macro.parseFile(mac.split('\r\n').map((l) => l.split(';').slice(1, 3).join(';')).join('\n'), 'trm.csv');
  assert(back.values.join() === '4230.25,4199.5,4301', 'macro: ' + back.values.join());
});

test('macro: lectores de FRED, Banco Mundial y datos.gov.co, y relación con el mercado', () => {
  const fred = PF.macro.parseFred('observation_date,LRHUTTTTCOM156S\n2024-01-01,10.5\n2024-02-01,.\n2024-03-01,10.1\n2024-04-01,9.9\n');
  assert(fred.dates.join() === '2024-01-01,2024-03-01,2024-04-01' && fred.values[2] === 9.9);
  const wb = PF.macro.parseWorldBank([{ page: 1 }, [{ date: '2023', value: 0.6 }, { date: '2022', value: 7.3 }, { date: '2021', value: 10.8 }, { date: '2020', value: null }]]);
  assert(wb.dates[0] === '2021-12-31' && wb.values.join() === '10.8,7.3,0.6');
  const soc = PF.macro.parseSocrata([{ vigenciadesde: '2024-01-03T00:00:00.000', valor: '3900.5' }, { vigenciadesde: '2024-01-02T00:00:00.000', valor: '3,950.25' }, { vigenciadesde: '2024-01-04T00:00:00.000', valor: '3880' }]);
  assert(soc.dates[0] === '2024-01-02' && soc.values[0] === 3950.25);
  const file = PF.macro.parseFile('Fecha;Valor\n2024-01;9,28\n2024-02;8,35\n2024-03;7,36\n', 'ipc.csv');
  assert(file.values[1] === 8.35 && file.dates[0] === '2024-01-28');
  // Mercado mensual que cae 0,8 % por cada 1 % que sube la TRM
  const R = rng(9);
  const days = [];
  for (let d = Date.UTC(2020, 0, 1); d < Date.UTC(2024, 0, 1); d += 864e5) days.push(new Date(d).toISOString().slice(0, 10));
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const dx = months.map(() => 0.03 * (R() - 0.5));
  let trm = 4000;
  let px = 1000;
  const mPrice = {};
  const trmVals = days.map((d) => {
    const k = months.indexOf(d.slice(0, 7));
    if (d.slice(8) === '01') {
      trm *= Math.exp(dx[k]);
      px *= Math.exp(-0.8 * dx[k] + 0.002 * (R() - 0.5));
    }
    mPrice[d] = px;
    return trm;
  });
  const res = PF.macro.relate({ dates: days, prices: days.map((d) => mPrice[d]) }, { dates: days, values: trmVals }, 'trm');
  assert(res.ok && res.freq === 'M' && res.n > 40 && res.corr < -0.9, `ρ = ${res.corr}`);
  assert(Math.abs(res.b * 100 + 0.8) < 0.15, 'b ≈ −0,8 pp por 1 % de TRM: ' + res.b * 100);
  assert(/negativa fuerte/.test(PF.macro.interpret(res, 'trm', 'COLCAP')));
  const csv = PF.macro.toCSV({ desempleo: Object.assign(fred, { source: 'FRED' }) });
  assert(csv.split('\r\n').length === 4 && /desempleo;2024-04-01;9,9;%;"FRED"/.test(csv));
});

test('índices: volumen, rotación y frecuencia del COLEQTY; índice propio por capitalización y liquidez', () => {
  const d0 = Date.UTC(2025, 0, 1);
  const days = [];
  for (let i = 0; i < 400; i++) {
    const t = d0 + i * 864e5;
    if (new Date(t).getUTCDay() % 6) days.push(new Date(t).toISOString().slice(0, 10));
  }
  const A = { name: 'A', dates: days, prices: days.map((_, i) => 100 + i), qty: days.map(() => 10), vol: days.map(() => 1000) };
  const B = { name: 'B', dates: days.filter((_, i) => i % 2 === 0), prices: days.filter((_, i) => i % 2 === 0).map(() => 50), qty: days.filter((_, i) => i % 2 === 0).map(() => 4), vol: days.filter((_, i) => i % 2 === 0).map(() => 200) };
  const asOf = days[days.length - 1];
  const la = PF.indices.liquidity(A, asOf, 1000, days);
  const lb = PF.indices.liquidity(B, asOf, 100, days);
  const n360 = days.filter((d) => Date.parse(d) > Date.parse(asOf) - 360 * 864e5).length;
  const n180 = days.filter((d) => Date.parse(d) > Date.parse(asOf) - 180 * 864e5).length;
  assert(la.V === 1000 * n360 && near(la.R, (n180 * 10 / 1000) * 100, 1e-9) && la.T === 100, JSON.stringify(la));
  assert(Math.abs(lb.T - 50) < 2 && lb.V < la.V, 'B negocia la mitad de las ruedas: ' + lb.T);
  assert(Number.isNaN(PF.indices.liquidity(A, asOf, 0, days).R), 'sin acciones en circulación no hay rotación');
  // Índice propio: pesos iniciales por capitalización y valores base 100
  const table = { names: ['A', 'B'], dates: ['2025-01-01', '2025-01-02', '2025-01-03'], values: [[100, 110, 121], [50, 50, 55]] };
  const cap = PF.indices.buildIndex(table, ['A', 'B'], 'cap', { shares: { A: 10, B: 20 }, V: {} });
  assert(near(cap.w[0], 0.5, 1e-12) && cap.values[0] === 100 && near(cap.values[1], 105, 1e-9) && near(cap.values[2], 0.5 * 121 + 0.5 * 110, 1e-9), cap.values.join());
  const pr = PF.indices.buildIndex(table, ['A', 'B'], 'precio', { shares: {}, V: {} });
  assert(near(pr.values[1], 100 * 160 / 150, 1e-9), 'ponderado por precios = Σ P / divisor');
  assert(PF.indices.buildIndex(table, ['A', 'B'], 'cap', { shares: { A: 10 }, V: {} }).error, 'falta N de B');
  // Página del sistema financiero con referencias
  const html = PF.sistema.render({ macro: {}, results: {}, classes: ['accion', 'cdt'], esc: String }) + PF.indices.render({ series: [A, B], table, model: null, shares: {}, method: 'liq', clsOf: () => 'accion', esc: String, num: String, pct: String, money: String });
  assert(/Mercado monetario/.test(html) && /Mercado extrabursátil/.test(html) && /COLEQTY/.test(html) && /Markowitz, H\. \(1952\)/.test(html) && /class="sf-node on/.test(html));
});

test('biblioteca: tramos de 6 meses de una acción = un solo activo; valores guardados fijos; fecha de corte', async () => {
  const csv = (rows) => '﻿Fecha;Nemotécnico;Precio cierre;Cantidad;Volumen\n' + rows.map(([d, p]) => `${d};ECOPETROL;${p};1,000.00;${parseFloat(p.replace(/,/g, '')) * 1000}`).join('\n');
  // Dos descargas de la BVC: enero-junio y julio-diciembre, con nombres de archivo distintos
  const a = PF.data.readText(csv([['2025-01-02', '2,000.00'], ['2025-03-03', '2,100.00'], ['2025-06-30', '2,200.00']]), 'ECOPETROL_20250701_101010.csv').series;
  const b = PF.data.readText(csv([['2025-07-01', '2,300.00'], ['2025-12-30', '2,400.00']]), 'ecopetrol_20260105_2.csv').series;
  const c = PF.data.readText('Fecha;Valor hoy\n2025/01/02;1,300.00\n2025/06/30;1,400.00\n2025/12/30;1,500.00', 'MSCI_COLCAP_20260105_1.csv').series;
  const d = PF.data.readText('Fecha;Valor hoy\n2026/01/02;1,510.00\n2026/01/05;1,520.00', 'MSCI COLCAP (1).csv').series;
  const merged = PF.data.combineSeries(a.concat(b, c, d));
  assert(merged.length === 2, 'dos activos, no cuatro: ' + merged.map((x) => x.name).join(', '));
  assert(PF.data.assetKey('MSCI_COLCAP') === PF.data.assetKey('msci colcap') && PF.data.assetKey('Ecopetról') === 'ECOPETROL');
  await PF.lib.clear();
  const r1 = await PF.lib.saveSeries(PF.data.combineSeries(a), 'archivo');
  const r2 = await PF.lib.saveSeries(PF.data.combineSeries(b), 'archivo');
  assert(r1.nuevas === 1 && r2.nuevas === 0 && r2.agregadas === 2, 'el segundo tramo se suma al mismo activo');
  // Un archivo que trae otro valor para una fecha ya guardada no la cambia
  const fix = PF.data.readText(csv([['2025-03-03', '9,999.00'], ['2026-01-02', '2,500.00']]), 'ECOPETROL.csv').series;
  const r3 = await PF.lib.saveSeries(PF.data.combineSeries(fix), 'archivo');
  const lib = await PF.lib.all();
  const eco = lib.series.find((x) => x.name === 'ECOPETROL');
  assert(lib.series.length === 1 && r3.agregadas === 1 && eco.dates.length === 6, JSON.stringify(eco.dates));
  assert(eco.prices[eco.dates.indexOf('2025-03-03')] === 2100, 'el valor guardado queda fijo');
  assert(eco.qty && eco.vol[0] === 2000000, 'guarda cantidad y volumen');
  // Fiel a la fuente: lo guardado es exactamente lo leído (sin redondeo ni relleno)
  const src = PF.data.combineSeries(a.concat(b))[0];
  assert(src.dates.every((d) => eco.prices[eco.dates.indexOf(d)] === src.prices[src.dates.indexOf(d)]), 'mismos valores que el archivo');
  assert(!eco.dates.includes('2025-01-03'), 'los días sin negociación no se guardan');
  // El relleno con el último precio se hace solo al calcular
  const other = (n) => ({ name: n, dates: ['2025-01-02', '2025-01-03', '2025-03-03', '2025-06-30'], prices: [1, 2, 3, 4] });
  const calc = PF.data.mergeSeries([PF.lib.toSeries(eco), other('X'), other('Y')], 'diaria');
  const ce = calc.values[calc.names.indexOf('ECOPETROL')];
  assert(ce[calc.dates.indexOf('2025-01-03')] === 2000, 'hueco completado con el cierre anterior al calcular');
  // Fecha de corte
  const cut = PF.lib.toSeries(eco, '2025-06-30');
  assert(cut.dates.join() === '2025-01-02,2025-03-03,2025-06-30' && cut.vol.length === 3);
  // Renta fija por tasas: se guarda la tasa y vuelve a ser índice al usarla
  const tes = PF.data.combineSeries(PF.data.readText('Fecha;Nemotécnico;Tasa\n2026-01-02;TFIT1;10.5\n2026-01-05;TFIT1;10.6\n2026-01-06;TFIT1;10.4', 't.csv').series);
  await PF.lib.saveSeries(tes, 'archivo');
  const t = (await PF.lib.all()).series.find((x) => x.name === 'TFIT1');
  assert(t.kind === 'tasa' && t.prices[0] === 0.105, 'tasa guardada: ' + t.prices[0]);
  const back = PF.data.combineSeries([PF.lib.toSeries(t)])[0];
  assert(back.prices[0] === 100 && back.prices[1] < 100, 'índice de rendimiento total');
  // Variables macro y respaldo
  await PF.lib.saveMacro('trm', { dates: ['2025-01-02', '2025-01-03'], values: [4000, 4010] }, 'datos.gov.co');
  const added = await PF.lib.saveMacro('trm', { dates: ['2025-01-03', '2025-01-06'], values: [9999, 4020] }, 'datos.gov.co');
  const m = (await PF.lib.all()).macro.trm;
  assert(added === 1 && m.values.join() === '4000,4010,4020');
  const json = JSON.parse(JSON.stringify(await PF.lib.exportJSON()));
  await PF.lib.clear();
  const imp = await PF.lib.importJSON(json);
  assert(imp.nuevas === 2 && (await PF.lib.all()).macro.trm.dates.length === 3);
  await PF.lib.clear();
});

test('TRM de datos.gov.co (VALOR con $ y coma decimal, VIGENCIADESDE): se lee en Datos y en Macro', () => {
  const csv = '"VALOR","UNIDAD","VIGENCIADESDE","VIGENCIAHASTA"\n"$3.209,78","COP","06/10/2026","06/10/2026"\n"$3.273,49","COP","03/10/2026","05/10/2026"\n"$3.307,73","COP","02/10/2026","02/10/2026"\n"$3.312,84","COP","01/10/2026","01/10/2026"\n"$643,42","COP","02/12/1991","02/12/1991"\n';
  const r = PF.data.readText(csv, 'Tasa_de_Cambio_Representativa_del_Mercado-_TRM_20261006.csv');
  const s = r.series[0];
  assert(s.name === 'TRM' && s.dates[0] === '1991-12-02' && s.prices[s.prices.length - 1] === 3209.78, JSON.stringify([s.name, s.dates, s.prices]));
  const d = PF.macro.parseFile(csv, 'trm.csv');
  assert(d.dates.length === 5 && d.values[d.values.length - 1] === 3209.78 && d.values[0] === 643.42, JSON.stringify(d));
});

test('Matriz de precios: sin sábados ni domingos (la TRM del sábado pasa al lunes)', () => {
  const mx = PF.matriz.build([{ name: 'ECOPETROL', dates: ['2026-10-02', '2026-10-05'], prices: [1, 2] }, { name: 'TRM', dates: ['2026-10-02', '2026-10-03'], prices: [10, 11] }]);
  assert(mx.dates.join() === '2026-10-02,2026-10-05' && mx.values[1].join() === '10,11' && mx.filled[1][1], JSON.stringify(mx));
  // Fechas corridas de un solo activo (domingo, lunes festivo) y festivos sin cambios no son ruedas
  const base = ['2026-08-13', '2026-08-14', '2026-08-18', '2026-08-19'];
  const mk = (n, k) => ({ name: n, dates: base.slice(), prices: base.map((_, i) => 100 + k + i * (k + 1)) });
  const lst = [mk('A', 0), mk('B', 1), mk('C', 2), mk('D', 3), mk('F', 4), { name: 'E', dates: ['2026-08-16', '2026-08-17'], prices: [5, 6] }];
  lst.slice(0, 5).forEach((x) => { x.dates.push('2026-08-17'); x.prices.push(x.prices[1]); });
  lst.slice(0, 5).forEach((x) => { const o = x.dates.map((d, i) => [d, x.prices[i]]).sort(); x.dates = o.map((q) => q[0]); x.prices = o.map((q) => q[1]); });
  const mh = PF.matriz.build(lst);
  assert(mh.dates.join() === base.join(), 'sin domingo ni festivo: ' + mh.dates.join());
  const mf = PF.matriz.build([{ name: 'A', dates: ['2023-08-18', '2023-08-22', '2023-08-23'], prices: [1, 2, 3] }], { from: '2023-08-22' });
  assert(mf.dates[0] === '2023-08-22', 'fecha de inicio');
});

test('Escala de Likert de las correlaciones: rojo −1, amarillo 0, verde +1', () => {
  const L = PF.stats.likert;
  assert(L(1).color === '#63be7b' && L(0).color === '#ffeb84' && L(-1).color === '#f8696b', [L(1).color, L(0).color, L(-1).color].join());
  assert(L(0.9).label === 'Totalmente de acuerdo' && L(0).label === 'Ni de acuerdo ni en desacuerdo' && L(-0.9).label === 'Totalmente en desacuerdo' && L(0.4).point === 4);
  const x = PF.xlsx.build([{ name: 'C', rows: [[1, 0.5], [0.5, 1]], colorScale: ['A1:B2'] }]);
  assert(new TextDecoder().decode(x).includes('<cfRule type="colorScale"'), 'formato condicional en el xlsx');
});

test('Tasa libre de riesgo y primas: candidatas de renta fija, Fisher, PRP de Damodaran', () => {
  const dates = [];
  const px = [];
  for (let k = 0; k <= 400; k++) {
    dates.push(new Date(Date.UTC(2025, 0, 1) + k * 864e5).toISOString().slice(0, 10));
    px.push(100 * Math.pow(1.09, k / 365));
  }
  const c = PF.riesgo.rfCandidates([{ name: 'COLIBR', dates, prices: px }, { name: 'TES 2036', kind: 'tasa', dur: 7, dates: dates.slice(0, 3), prices: [0.11, 0.111, 0.112] }, { name: 'ECOPETROL', dates, prices: px }]);
  assert(c.length === 2 && c[0].name === 'TES 2036' && near(c[0].value, 0.112, 1e-12), JSON.stringify(c));
  assert(near(c[1].value, 0.09, 1e-6), 'COLIBR ' + c[1].value);
  assert(near(PF.riesgo.fisher(0.04, 0.05, 0.02), (1.04 * 1.05) / 1.02 - 1, 1e-12));
  const q = PF.riesgo.premiums({ tes10: 11, ust10: 4, picol: 5, pius: 2, erp: 4.5, embi: 250, ratio: 1.5 }, { rf: 0.09 });
  assert(near(q.spread, 0.025, 1e-12) && near(q.prp, 0.0375, 1e-12) && near(q.rfLocal, 0.085, 1e-12) && near(q.em, 0.085 + 0.045 + 0.0375, 1e-12), JSON.stringify(q));
  const q2 = PF.riesgo.premiums({ tes10: 11, ust10: 4, picol: 5, pius: 2 }, { volRatio: 2 });
  assert(near(q2.spread, 0.11 - PF.riesgo.fisher(0.04, 0.05, 0.02), 1e-12) && q2.ratio === 2 && q2.spreadSrc === 'TES');
});

test('Graficador del Banco de la República: tasas cero cupón TES como tasas; bid-ask se rechaza con explicación', () => {
  const z = [['Fecha', 'Tasa cero cupón TES pesos 1 año (Dato diario)', 'Tasa cero cupón TES pesos 10 años (Dato diario)'], ['dd/mm/aaaa', 'Porcentaje', 'Porcentaje'], ['22/08/2023', '11,52', '10,31'], ['23/08/2023', '11,50', '10,40'], ['24/08/2023', '11,48', '10,35'], [''], ['Descargado de sistema del Banco de la República']];
  const s = PF.data.readRows(z, 'graficador_series.xlsx').series;
  assert(s.length === 2 && s[0].kind === 'tasa' && s[0].dur === 1 && s[1].dur === 10 && near(s[1].prices[2], 0.1035, 1e-12) && s[0].dates[0] === '2023-08-22', JSON.stringify(s));
  const c = PF.riesgo.rfCandidates(s);
  assert(c.length === 2 && near(c[1].value, 0.1035, 1e-12), 'candidatas: ' + JSON.stringify(c));
  let msg = '';
  try {
    PF.data.readRows([['Fecha', 'BID-ASK Spread TES Pesos(Dato diario)'], ['dd/mm/aaaa', 'Pesos colombianos'], ['22/08/2023', '6,04'], ['23/08/2023', '4,52']], 'g.xlsx');
  } catch (e) {
    msg = e.message;
  }
  assert(/liquidez/.test(msg) && /cero cupón/.test(msg), msg);
});

test('Tasas cero cupón TES del Banco de la República (CSV de suameca): seis series de referencia', () => {
  const csv = '﻿"Periodo(MMM DD, AAAA)";"Tasa de interés Cero Cupón, Títulos de Tesorería (TES), pesos - 1 año";"Tasa de interés Cero Cupón, Títulos de Tesorería (TES), pesos - 10 años";"Tasa de interés Cero Cupón, Títulos de Tesorería (TES), UVR - 10 años"\n"2026/09/30";12,34;13,2;6,7\n"2026/10/01";12,45;13,2;\n"2026/10/02";12,44;13,3;6,84\n';
  const r = PF.data.readText(csv, 'Deuda_p_blica.csv');
  assert(r.series.map((s) => s.name).join() === 'TES cero cupón pesos 1 año,TES cero cupón pesos 10 años,TES cero cupón UVR 10 años', r.series.map((s) => s.name).join());
  assert(r.series.every((s) => s.kind === 'tasa' && s.ref) && r.series[1].dur === 10 && near(r.series[1].prices[2], 0.133, 1e-12) && r.series[2].dates.length === 2);
  // Por la biblioteca: la tasa vuelve como «rates» (prices es el índice) y la candidata usa la tasa
  const comb = PF.data.combineSeries(r.series).find((x) => /pesos 10/.test(x.name));
  const { rec } = PF.lib.mergeRecord(null, Object.assign({}, comb, { prices: comb.rates }), 'archivo', '2026-10-06');
  assert(rec.ref && near(rec.prices[2], 0.133, 1e-12), JSON.stringify(rec));
  const back = PF.data.combineSeries([PF.lib.toSeries(rec)]);
  const c = PF.riesgo.rfCandidates(back);
  assert(back[0].ref && near(c[0].value, 0.133, 1e-12), JSON.stringify(c));
  assert(Object.keys(PF.tesBanrep.series).length === 6, 'semilla de TES');
});

test('Documentos para la tasa libre de riesgo y el riesgo país: FRED, EMBIG, Damodaran', () => {
  const ust = PF.data.readText('observation_date,DGS10\n2026-08-19,4.65\n2026-08-20,\n2026-08-21,4.74\n', 'TES_EEUU.csv').series[0];
  assert(ust.role === 'ust10' && ust.ref && ust.kind === 'tasa' && near(ust.prices[1], 0.0474, 1e-12) && ust.dates.length === 2, JSON.stringify(ust));
  const ie = PF.data.readText('observation_date,T10YIE\n2026-08-20,2.34\n2026-08-21,2.34\n', 'x.csv').series[0];
  assert(ie.role === 'infl-us' && near(ie.prices[0], 0.0234, 1e-12));
  const em = PF.data.readText('"","PD04715XD"\n"","Tasas de interés: EMBIG (variación en pbs) - Spread - EMBIG Colombia (pbs)"\n29Ago25,282\n01Set25,282\n21Ago26,188\n', 'EMBG.csv').series[0];
  assert(em.role === 'embi' && em.dates.join() === '2025-08-29,2025-09-01,2026-08-21' && near(em.prices[2], 0.0188, 1e-12), JSON.stringify(em));
  // Ninguna de las tres es candidata a tasa libre de riesgo en pesos
  assert(PF.riesgo.rfCandidates(PF.data.combineSeries([ust, ie, em]).map((x) => Object.assign(x, { dates: x.dates.concat(['2026-08-24']), rates: (x.rates || x.prices).concat([0.05]) }))).length === 0);
  const ctry = [["Country","Moody's rating","Adj. Default Spread","Country Risk Premium","Equity Risk Premium","Corporate Tax Rate","Sovereignn CDS ","ERP based on sovereign CDSS"],["Australia","Aaa","0.00%","0.00%","4.23%","30.00%","0.05%","4.31%"],["Colombia","Baa3","1.87%","2.85%","7.08%","35.00%","3.20%","9.09%"]];
  const c = PF.riesgo.readReference([ctry], 'ctryprem.xlsx');
  assert(c.kind === 'ctryprem' && c.data.rating === 'Baa3' && near(c.data.crp, 0.0285, 1e-12) && near(c.data.mature, 0.0423, 1e-12) && near(c.data.ratio, 0.0285 / 0.0187, 1e-12) && near(c.data.tax, 0.35, 1e-12), JSON.stringify(c));
  const impl = [['Date updated:', 'x'], ['Year', 'Earnings Yield', 'T.Bond Rate', 'Implied Premium (DDM)', 'Implied ERP (FCFE)'], [2024, 0.04, 0.0458, 0.0433, 0.0433], [2025, 0.039, 0.0418, 0.0423, 0.0423], ['', '']];
  const i = PF.riesgo.readReference([impl], 'histimpl.xls');
  assert(i.kind === 'implied' && i.data.year === 2025 && near(i.data.erp, 0.0423, 1e-12) && near(i.data.tbond, 0.0418, 1e-12), JSON.stringify(i));
  assert(PF.data.roleFromName('TES cero cupón UVR 10 años') === 'tes-uvr-10' && PF.data.roleFromName('Tesoro de EE. UU. 10 años (DGS10)') === 'ust10');
});

Promise.all(pending).then(() => {
  console.log(`${passed} pruebas correctas, ${failed} fallidas`);
  if (failed) process.exit(1);
});
