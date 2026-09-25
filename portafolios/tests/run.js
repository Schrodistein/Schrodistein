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

console.log(`${passed} pruebas correctas, ${failed} fallidas`);
if (failed) process.exit(1);
