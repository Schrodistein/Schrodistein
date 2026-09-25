/* Pruebas sin dependencias: node portafolios/tests/run.js */
'use strict';
const path = require('path');
for (const f of ['stats', 'optim', 'model', 'sample']) require(path.join(__dirname, '..', 'js', f + '.js'));
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
  assert(d.dropped === 1 && d.dates[0] === '2024-01');
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


console.log(`${passed} pruebas correctas, ${failed} fallidas`);
if (failed) process.exit(1);
