/* Pruebas sin dependencias: node portafolios/tests/run.js */
'use strict';
const path = require('path');
for (const f of ['stats', 'optim', 'model', 'sample', 'plan', 'xlsx', 'report']) require(path.join(__dirname, '..', 'js', f + '.js'));
const PF = globalThis.PF;
const { dot, quad, matVec, solve } = PF.stats;
let failed = 0;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error('✗ ' + name + '\n  ' + e.message);
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
  const c1 = PF.model.confirm(m, P.tangency.w, 0, 0.2);
  assert(c1.verdict === 'eficiente', 'tangente: ' + c1.verdict + ' ' + c1.retGap);
  const c2 = PF.model.confirm(m, P.equal.w, 0, 0.2);
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
    [1, new Date(2026, 7, 21), 2459.23, 2715, 91840],
    [2, new Date(2026, 7, 20), 2444.32, 2780, 88640],
    [3, new Date(2026, 7, 19), 2453.87, 2775, 88720],
    [4, new Date(2026, 7, 18), '', 2770, ''],
    ['', 'RENDIMIENTO ESPERADO', 0.1, 0.2, 0.3],
  ];
  const r = PF.data.readRows(rows, 'libro.xlsx');
  assert(r.layout === 'ancho' && !r.returnsLike);
  assert(r.series.map((x) => x.name).join() === 'MSCI COLCAP,ECOPETROL,CIBEST', r.series.map((x) => x.name).join());
  const e = r.series[1];
  assert(e.dates.join() === '2026-08-18,2026-08-19,2026-08-20,2026-08-21' && e.prices[0] === 2770);
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
  const items = [{ name: 'A', w: 0.5, price: 2715 }, { name: 'B', w: 0.3, price: 48400 }, { name: 'C', w: 0.2, price: 91840 }];
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
  assert(small.tries.every((t) => !t.ev || t.ev.netSharpe <= small.best.ev.netSharpe + 1e-12), 'elige el mejor Sharpe neto');
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
  assert(eRow && near(eRow[1].v, P.tangency.ret, 1e-12) && /^SUMPRODUCT/.test(eRow[1].f));
  const bytes = rep.bytes();
  assert(bytes.length > 50000 && bytes[0] === 0x50);
});


console.log(`${passed} pruebas correctas, ${failed} fallidas`);
if (failed) process.exit(1);
