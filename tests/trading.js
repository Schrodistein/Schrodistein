/* Pruebas de Radar de Divisas, sin dependencias: node tests/trading.js */
'use strict';
const path = require('path');
for (const f of ['core', 'indicators', 'patterns', 'stats', 'signals', 'backtest', 'binance', 'forex', 'feeds']) {
  require(path.join(__dirname, '..', 'trading', 'js', f + '.js'));
}
const FX = globalThis.FX;
const { util: U, ind: I, patterns: P, stats: ST, signals: SG, backtest: BT, risk: RK, binance: API, forex: F, feeds: FEEDS } = FX;

let failed = 0;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error('✗ ' + name + '\n  ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n  '));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'aserción fallida');
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;

// Velas a partir de una trayectoria de cierres, con mechas pequeñas.
function fromCloses(closes, wick) {
  wick = wick == null ? 0.0005 : wick;
  return closes.map((c, k) => {
    const o = k ? closes[k - 1] : c;
    return { t: Date.UTC(2026, 0, 1) + k * 3600e3, o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c, v: 1000, T: Date.UTC(2026, 0, 1) + (k + 1) * 3600e3 - 1, closed: true };
  });
}
// Trayectoria lineal por tramos: [[precio, velas], ...]
function path_(start, legs) {
  const out = [start];
  let p = start;
  for (const [to, n] of legs) {
    for (let k = 1; k <= n; k++) out.push(p + ((to - p) * k) / n);
    p = to;
  }
  return out;
}

/* ---------- Indicadores ---------- */
test('SMA y EMA', () => {
  const s = I.sma([1, 2, 3, 4, 5], 3);
  assert(isNaN(s[1]) && s[2] === 2 && s[4] === 4);
  const e = I.ema([1, 2, 3, 4, 5], 3);
  assert(isNaN(e[1]) && e[2] === 2 && e[3] === 3 && e[4] === 4, 'EMA sembrada con la media simple');
  const k = I.ema(new Array(50).fill(7), 10);
  assert(k[49] === 7, 'EMA de una constante');
});

test('RSI de Wilder (ejemplo de referencia)', () => {
  const c = [44.3389, 44.0902, 44.1497, 43.6124, 44.2778, 44.8303, 45.0849, 45.4199, 45.8484, 46.0826, 45.8935, 46.0328, 45.614, 46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6427];
  const r = I.rsi(c, 14);
  assert(isNaN(r[13]), 'el primer valor llega en la vela 14');
  [70.53, 66.32, 66.55, 69.41, 66.36, 57.97].forEach((v, k) => assert(near(r[14 + k], v, 0.02), `RSI[${14 + k}] = ${r[14 + k]} ≠ ${v}`));
  const up = I.rsi(Array.from({ length: 40 }, (_, k) => k + 1), 14);
  assert(up[39] === 100, 'serie siempre al alza → 100');
});

test('ATR, Bollinger y MACD en casos límite', () => {
  const C = fromCloses(new Array(60).fill(1), 0.01);
  const S = U.toSeries(C);
  assert(near(I.atr(S.h, S.l, S.c, 14)[59], 0.02, 1e-12), 'ATR = rango constante');
  const bb = I.bollinger(S.c, 20, 2);
  assert(bb.upper[59] === 1 && bb.lower[59] === 1, 'Bollinger sin volatilidad');
  const lin = Array.from({ length: 100 }, (_, k) => 100 + k);
  const m = I.macd(lin);
  assert(m.line[99] > 0 && near(m.hist[99], 0, 1e-9), 'tendencia lineal: MACD positivo y estable');
});

test('Osciladores acotados y ADX en tendencia', () => {
  const S = U.toSeries(U.synthetic(800, { seed: 5 }));
  const st = I.stochastic(S.h, S.l, S.c);
  const mf = I.mfi(S.h, S.l, S.c, S.v);
  const cf = I.cmf(S.h, S.l, S.c, S.v);
  for (let i = 40; i < 800; i++) {
    assert(st.k[i] >= 0 && st.k[i] <= 100, 'estocástico en [0, 100]');
    assert(mf[i] >= 0 && mf[i] <= 100, 'MFI en [0, 100]');
    assert(cf[i] >= -1 && cf[i] <= 1, 'CMF en [-1, 1]');
  }
  const T = U.toSeries(fromCloses(path_(1, [[1.5, 120]]), 0.002));
  const a = I.adx(T.h, T.l, T.c, 14);
  assert(a.adx[120] > 40 && a.pdi[120] > a.mdi[120], 'ADX alto y +DI dominante en subida limpia');
});

test('Supertrend e Ichimoku', () => {
  const up = U.toSeries(fromCloses(path_(1, [[1.3, 80]]), 0.003));
  assert(I.supertrend(up.h, up.l, up.c).dir[80] === 1);
  const dn = U.toSeries(fromCloses(path_(1.3, [[1, 80]]), 0.003));
  assert(I.supertrend(dn.h, dn.l, dn.c).dir[80] === -1);
  const S = U.toSeries(U.synthetic(300, { seed: 9 }));
  const ich = I.ichimoku(S.h, S.l, S.c);
  const i = 250;
  assert(near(ich.senkouA[i], (ich.tenkan[i - 26] + ich.kijun[i - 26]) / 2, 1e-12), 'la nube se desplaza 26 velas');
  assert(ich.ahead.length === 26 && near(ich.ahead[25].a, (ich.tenkan[299] + ich.kijun[299]) / 2, 1e-12), 'nube proyectada');
});

/* ---------- Patrones ---------- */
function withDowntrend(lastBars) {
  // 12 velas bajistas y después las velas del patrón.
  const C = [];
  let p = 1.2;
  for (let k = 0; k < 12; k++) {
    C.push({ o: p, c: p - 0.01, h: p + 0.002, l: p - 0.012 });
    p -= 0.01;
  }
  return C.concat(lastBars(p)).map((k, j) => Object.assign({ t: j * 3600e3, v: 1000 }, k));
}
const patternAtEnd = (C) => {
  const S = U.toSeries(C);
  const atr = I.atr(S.h, S.l, S.c, 14);
  return P.candles(S, S.n - 1, atr[S.n - 1] || 0.012).map((x) => x.key);
};

test('Velas: envolvente alcista, martillo, estrella de la mañana', () => {
  const eng = withDowntrend((p) => [{ o: p, c: p - 0.008, h: p + 0.001, l: p - 0.009 }, { o: p - 0.009, c: p + 0.004, h: p + 0.005, l: p - 0.01 }]);
  assert(patternAtEnd(eng).includes('bullEngulfing'), 'envolvente: ' + patternAtEnd(eng));
  const ham = withDowntrend((p) => [{ o: p, c: p + 0.002, h: p + 0.0025, l: p - 0.012 }]);
  assert(patternAtEnd(ham).includes('hammer'), 'martillo: ' + patternAtEnd(ham));
  const star = withDowntrend((p) => [{ o: p, c: p - 0.014, h: p + 0.001, l: p - 0.015 }, { o: p - 0.015, c: p - 0.0145, h: p - 0.013, l: p - 0.017 }, { o: p - 0.014, c: p - 0.004, h: p - 0.003, l: p - 0.015 }]);
  assert(patternAtEnd(star).includes('morningStar'), 'estrella: ' + patternAtEnd(star));
  const flat = withDowntrend((p) => [{ o: p, c: p - 0.01, h: p + 0.002, l: p - 0.012 }]);
  assert(!patternAtEnd(flat).some((k) => ['bullEngulfing', 'hammer', 'morningStar'].includes(k)), 'sin falsos positivos');
});

test('Pivotes: solo se conocen tras su confirmación', () => {
  const S = U.toSeries(U.synthetic(500, { seed: 4 }));
  const piv = P.pivots(S, 3, 3);
  assert(piv.length > 20);
  for (const p of piv) assert(p.at === p.i + 3);
  for (const i of [100, 250, 400]) for (const p of P.recent(piv, i, 120)) assert(p.at <= i && p.i >= i - 120);
});

test('Soportes y resistencias agrupan toques', () => {
  const C = fromCloses(path_(1.0, [[1.1, 10], [1.0, 10], [1.1, 10], [1.0, 10], [1.05, 10]]), 0.002);
  const S = U.toSeries(C);
  const atr = I.atr(S.h, S.l, S.c, 14);
  const lv = P.levels(P.pivots(S), S, S.n - 1, atr[S.n - 1]);
  assert(lv.resistances.length && near(lv.resistances[0].price, 1.102, 0.003) && lv.resistances[0].touches >= 2, JSON.stringify(lv.resistances));
  assert(lv.supports.length && near(lv.supports[0].price, 0.998, 0.003), JSON.stringify(lv.supports));
});

test('Doble suelo confirmado al romper la clavicular', () => {
  const C = fromCloses(path_(1.1, [[1.0, 20], [1.05, 10], [1.0, 10], [1.08, 12]]), 0.001);
  const S = U.toSeries(C);
  const piv = P.pivots(S);
  const atr = I.atr(S.h, S.l, S.c, 14);
  let found = null;
  for (let i = 30; i < S.n; i++) for (const e of P.doubles(S, P.recent(piv, i, 120), i, atr[i])) if (e.key === 'doubleBottom') found = { i, e };
  assert(found, 'doble suelo no detectado');
  assert(S.c[found.i] > 1.05 && S.c[found.i - 1] <= 1.051, 'se dispara al cruzar la clavicular');
  assert(near(found.e.target, 1.051 + 0.052, 0.005), 'objetivo = clavicular + altura');
});

test('Fibonacci y puntos pivote', () => {
  const C = fromCloses(path_(1.0, [[1.2, 40], [1.13, 10]]), 0.001);
  const S = U.toSeries(C);
  const atr = I.atr(S.h, S.l, S.c, 14);
  const f = P.fibonacci(S, S.n - 1, atr[S.n - 1]);
  assert(f && f.upSwing, 'tramo alcista');
  const r618 = f.retr.find((x) => x.r === 0.618).price;
  assert(near(r618, f.hi - 0.618 * (f.hi - f.lo), 1e-12));
  const pp = P.pivotPoints(U.toSeries(U.synthetic(100, { seed: 1 })), 99, 3600e3);
  assert(pp && pp.R1 > pp.P && pp.P > pp.S1 && pp.R2 > pp.R1 && pp.S2 < pp.S1);
});

/* ---------- Estadística ---------- */
test('Hurst distingue persistencia y reversión', () => {
  const R = U.rng(11);
  const H = (phi) => mean(Array.from({ length: 12 }, () => {
    let x = 0;
    return ST.hurst(Array.from({ length: 512 }, () => (x = phi * x + R.normal())));
  }));
  const h0 = H(0);
  assert(near(h0, 0.5, 0.06), 'paseo aleatorio ≈ 0,5: ' + h0);
  assert(H(0.4) > h0 + 0.04 && H(-0.4) < h0 - 0.04, 'orden persistente > aleatorio > antipersistente');
  assert(near(ST.lgamma(5), Math.log(24), 1e-9) && near(ST.lgamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-9));
});

test('GARCH(1,1) recupera parámetros simulados', () => {
  const R = U.rng(3);
  let h = 1e-4;
  const r = [];
  const w = 1e-4 * (1 - 0.1 - 0.85);
  for (let t = 0; t < 4000; t++) {
    const e = Math.sqrt(h) * R.normal();
    r.push(e);
    h = w + 0.1 * e * e + 0.85 * h;
  }
  const g = ST.garch(r);
  assert(g.alpha >= 0.05 && g.alpha <= 0.18 && g.beta >= 0.75 && g.beta <= 0.92, `α=${g.alpha} β=${g.beta}`);
  assert(near(ST.forecastVar(g, 1), g.next, 1e-15) && near(ST.forecastVar(g, 5000), g.lr, g.lr * 1e-3), 'la previsión converge a la varianza a largo plazo');
});

test('Simulación: cono ordenado y barreras simétricas', () => {
  const R = U.rng(8);
  const g = ST.garch(Array.from({ length: 1500 }, () => 0.01 * R.normal()));
  const sim = ST.simulate(100, g, { horizon: 30, paths: 4000, seed: 1, up: 102, down: 100 / 1.02 });
  for (const row of sim.cone) assert(row.q5 < row.q25 && row.q25 < row.q50 && row.q50 < row.q75 && row.q75 < row.q95, 'cuantiles ordenados');
  assert(sim.cone[29].q95 - sim.cone[29].q5 > sim.cone[0].q95 - sim.cone[0].q5, 'el cono se abre con el tiempo');
  assert(near(sim.pUp + sim.pDown + sim.pNone, 1, 1e-12));
  assert(near(sim.pUp, sim.pDown, 0.05), `barreras simétricas con deriva nula: ${sim.pUp} vs ${sim.pDown}`);
  const [lo, hi] = ST.wilson(30, 100);
  assert(lo < 0.3 && hi > 0.3 && lo > 0.2 && hi < 0.4, 'intervalo de Wilson');
});

/* ---------- Señales ---------- */
test('Sin mirar al futuro: la señal en i no depende de velas posteriores', () => {
  const C = U.synthetic(900, { seed: 21 });
  const full = SG.analyze(C, { interval: '1h' });
  const pick = (r) => JSON.stringify([r.dir, r.long.score, r.short.score, r.long.reasons.map((x) => x.text), r.short.reasons.map((x) => x.text), r.stop, r.target]);
  for (const i of [150, 299, 420, 611, 777, 898]) {
    const cut = SG.analyze(C.slice(0, i + 1), { interval: '1h' });
    assert(pick(SG.evaluate(full, i, {})) === pick(SG.evaluate(cut, i, {})), 'diferencia en la vela ' + i);
  }
});

test('Temporalidad superior: solo cambia al cerrar la vela de 4 h', () => {
  const C = U.synthetic(800, { seed: 2, intervalMs: 3600e3 });
  const ctx = SG.analyze(C, { interval: '1h' });
  assert(ctx.htf === '4h');
  for (let i = 1; i < ctx.n; i++) if (ctx.htfTrend[i] !== ctx.htfTrend[i - 1]) assert((C[i].t + 3600e3) % (4 * 3600e3) === 0, 'cambio a mitad de vela de 4 h en ' + i);
});

test('Señales: estructura, coherencia y perfiles', () => {
  const C = U.synthetic(1200, { seed: 13 });
  const ctx = SG.analyze(C, { interval: '1h' });
  const count = {};
  for (const prof of ['conservador', 'equilibrado', 'agresivo']) {
    const ev = SG.evaluateRange(ctx, { profile: prof, allowShort: true }, 0, ctx.n - 1);
    count[prof] = ev.filter((e) => e.dir).length;
    for (const e of ev) {
      if (!e.dir) continue;
      const side = e.dir > 0 ? e.long : e.short;
      assert(side.score >= e.threshold && side.triggerScore >= e.minTrigger, 'umbral respetado');
      assert(e.dir * (e.entry - e.stop) > 0 && e.dir * (e.target - e.entry) > 0, 'stop y objetivo en el lado correcto');
      assert(near(Math.abs(e.target - e.entry), 2 * Math.abs(e.entry - e.stop), 1e-9), 'R:R 2');
      assert(e.trend !== -e.dir, 'filtro de tendencia');
    }
  }
  assert(count.conservador <= count.equilibrado && count.equilibrado <= count.agresivo, JSON.stringify(count));
  assert(count.equilibrado > 10 && count.equilibrado < 0.2 * ctx.n, 'frecuencia razonable: ' + count.equilibrado);
  const ev = SG.evaluateRange(ctx, {}, 0, ctx.n - 1);
  for (let k = 0; k < ev.length; k++) if (SG.isFresh(ev, k)) for (let j = Math.max(0, k - SG.COOLDOWN); j < k; j++) assert(ev[j].dir !== ev[k].dir, 'una señal nueva no repite sentido en las 3 velas previas');
});

test('Proyección completa', () => {
  const C = U.synthetic(1000, { seed: 6 });
  const ctx = SG.analyze(C, { interval: '1h' });
  const sig = { dir: 1, stop: C[999].c * 0.99, target: C[999].c * 1.02, rr: 2 };
  const p = ST.project(ctx, 999, { horizon: 24, signal: sig, paths: 1000 });
  assert(p.cone.length === 24 && p.volAnnual > 0 && p.volPercentile >= 0 && p.volPercentile <= 1);
  assert(p.hit && near(p.hit.target + p.hit.stop + p.hit.none, 1, 1e-9) && near(p.hit.breakeven, 1 / 3, 1e-12));
});

/* ---------- Riesgo y backtest ---------- */
test('Tamaño de posición con comisiones y límite de apalancamiento', () => {
  const a = RK.positionSize({ capital: 1000, riskPct: 1, entry: 100, stop: 98, feePct: 0 });
  assert(near(a.qty, 5, 1e-12) && near(a.lossAtStop, 10, 1e-9));
  const b = RK.positionSize({ capital: 1000, riskPct: 1, entry: 100, stop: 98, feePct: 0.1 });
  assert(near(b.lossAtStop, 10, 1e-9) && b.qty < 5, 'las comisiones caben dentro del riesgo');
  const c = RK.positionSize({ capital: 1000, riskPct: 1, entry: 100, stop: 99.9, feePct: 0, maxLeverage: 1 });
  assert(c.capped && near(c.notional, 1000, 1e-9));
  const d = RK.positionSize({ capital: 1000, riskPct: 1, entry: 100, stop: 98, feePct: 0, stepSize: 0.3 });
  assert(near(d.qty, 4.8, 1e-9), 'redondeo al paso de cantidad');
});

test('Backtest: contabilidad y modo spot', () => {
  const C = U.synthetic(2500, { seed: 17 });
  const ctx = SG.analyze(C, { interval: '1h' });
  const r = BT.run(ctx, { capital: 1000, riskPct: 1, feePct: 0.1 });
  const s = r.stats;
  assert(s.trades > 5, 'hay operaciones');
  assert(s.shorts === 0, 'en spot no hay cortos');
  assert(near(1000 + r.trades.reduce((a, t) => a + t.pnl, 0), s.finalEquity, 1e-6), 'capital = inicial + resultados');
  for (const t of r.trades) assert(t.i0 > 200 && t.i1 >= t.i0 && t.i1 < ctx.n, 'índices válidos');
  const f = BT.run(ctx, { capital: 1000, riskPct: 1, feePct: 0.1, allowShort: true, maxLeverage: 3 });
  assert(f.stats.shorts > 0, 'con futuros hay cortos');
  const z = BT.run(ctx, { capital: 1000, riskPct: 1, feePct: 0, slippagePct: 0 });
  assert(z.stats.feesPaid === 0 && z.stats.finalEquity >= s.finalEquity, 'sin costes no se gana menos');
});

test('Backtest: si una vela toca stop y objetivo, cuenta el stop', () => {
  const C = fromCloses(path_(1, [[1.0001, 299]]), 0.0005);
  C.push({ t: C[299].t + 3600e3, o: 1.0001, h: 1.1, l: 0.9, c: 1.0001, v: 1000, T: 0, closed: true });
  for (let k = 0; k < 10; k++) C.push(Object.assign({}, C[299], { t: C[300].t + (k + 1) * 3600e3 }));
  const ctx = SG.analyze(C, { interval: '1h' });
  const orig = SG.evaluate;
  SG.evaluate = (cx, i) => (i === 299 ? { dir: 1, entry: 1.0001, stop: 0.99, target: 1.03, rr: 2, score: 9 } : { dir: 0 });
  try {
    const r = BT.run(ctx, { capital: 1000, riskPct: 1, feePct: 0, slippagePct: 0 });
    assert(r.trades.length === 1 && r.trades[0].reason === 'Stop' && near(r.trades[0].r, -1, 0.02), JSON.stringify(r.trades));
  } finally {
    SG.evaluate = orig;
  }
});

/* ---------- Binance ---------- */
test('Binance: formato de velas y decimales', () => {
  const k = API.parseKline([1700000000000, '1.08450000', '1.08600000', '1.08300000', '1.08500000', '1234.5', 1700003599999, '0', 10, '0', '0', '0'], 1700003600000);
  assert(k.o === 1.0845 && k.h === 1.086 && k.c === 1.085 && k.v === 1234.5 && k.closed === true);
  const w = API.parseWsKline({ t: 1, T: 2, o: '1', h: '2', l: '0.5', c: '1.5', v: '3', x: false });
  assert(w.c === 1.5 && w.closed === false);
  assert(U.decimalsFromTick('0.00010000') === 4 && U.decimalsFromTick('1.00000000') === 0 && U.decimalsFromTick('0.01') === 2);
  assert(API.tradeUrl({ base: 'EUR', quote: 'USDT' }, 'EURUSDT', false).endsWith('/trade/EUR_USDT?type=spot'));
});


/* ---------- Divisas ---------- */
test('Divisas: símbolos, pips y fuente de datos', () => {
  assert(F.normalize('eurusd').symbol === 'EUR/USD' && F.normalize('eur-usd').forex && F.normalize(' usd/jpy ').symbol === 'USD/JPY');
  assert(F.normalize('EURUSDT').symbol === 'EURUSDT' && !F.normalize('btcusdt').forex, 'los pares de Binance no se tocan');
  assert(F.pipSize('EUR/USD') === 0.0001 && F.pipSize('USD/JPY') === 0.01 && F.pipSize('XAU/USD') === 0.1);
  assert(F.decimals('EUR/USD') === 5 && F.decimals('GBP/JPY') === 3);
  assert(FEEDS.pick('EURUSDT').id === 'binance');
  assert(FEEDS.pick('EUR/USD').id === 'ecb' && FEEDS.pick('EUR/USD', { tdKey: 'x' }).id === 'twelvedata');
  assert(FEEDS.pick('XAU/USD') === null && FEEDS.pick('XAU/USD', { tdKey: 'x' }).id === 'twelvedata', 'el oro necesita Twelve Data');
  assert(F.currenciesOf('EURUSDT').join() === 'USD,EUR' && F.currenciesOf('PAXGUSDT').includes('XAU') && F.currenciesOf('USD/JPY').join() === 'USD,JPY');
});

test('Divisas: lotes y valor del pip en cualquier divisa de cuenta', () => {
  const a = F.lotSize({ symbol: 'EUR/USD', capital: 10000, riskPct: 1, entry: 1.1, stop: 1.095, account: 'USD' });
  assert(near(a.pips, 50, 1e-9) && near(a.units, 20000, 1e-6) && near(a.lots, 0.2, 1e-9) && near(a.pipValue, 2, 1e-9) && near(a.pipValueLot, 10, 1e-9));
  const b = F.lotSize({ symbol: 'USD/JPY', capital: 10000, riskPct: 1, entry: 150, stop: 149.5, account: 'USD' });
  assert(near(b.units, 30000, 1e-6) && near(b.pipValue, 2, 1e-9), 'cuenta en la divisa base');
  const rates = { USD: 1.1, GBP: 0.85, JPY: 165 };
  for (const [sym, e, st, acc] of [['EUR/USD', 1.1, 1.095, 'GBP'], ['GBP/JPY', 194, 193, 'EUR'], ['EUR/USD', 1.1, 1.104, 'EUR']]) {
    const r = F.lotSize({ symbol: sym, capital: 5000, riskPct: 2, entry: e, stop: st, account: acc, rates });
    assert(!r.error && near(r.pipValue * r.pips, 100, 1e-6), `${sym} en ${acc}: pip × pips = riesgo`);
  }
  assert(F.lotSize({ symbol: 'EUR/USD', capital: 1, riskPct: 1, entry: 1.1, stop: 1.0, account: 'MXN' }).error, 'sin tipos no hay conversión');
});

test('Divisas: sesiones con horario de verano', () => {
  const S = F.sessions(new Date(Date.UTC(2026, 9, 7, 14, 0)));
  const open = (id) => S.list.find((x) => x.id === id).isOpen;
  assert(open('london') && open('newyork') && !open('tokyo') && !open('sydney') && /Londres–Nueva York/.test(S.note));
  assert(!F.marketOpen(new Date(Date.UTC(2026, 9, 10, 12))), 'sábado cerrado');
  assert(!F.marketOpen(new Date(Date.UTC(2026, 9, 11, 20))) && F.marketOpen(new Date(Date.UTC(2026, 9, 11, 22))), 'reabre el domingo a las 17:00 de Nueva York');
  const sun = F.sessions(new Date(Date.UTC(2026, 9, 11, 22, 30)));
  assert(sun.list.find((x) => x.id === 'sydney').isOpen, 'Sídney abre el lunes a las 7:00 locales (domingo en UTC)');
  const l = S.list.find((x) => x.id === 'london');
  assert(l.changeIn === 120, 'Londres cierra a las 17:00 BST: ' + l.changeIn);
});

test('Divisas: fuerza relativa y correlaciones', () => {
  const day = (rates, k) => ({ date: 'd' + k, t: k, rates: Object.assign({ USD: 1.1, JPY: 160, GBP: 0.85, CHF: 0.95, CAD: 1.5, AUD: 1.65, NZD: 1.8 }, rates) });
  const series = [day({}, 0), day({ USD: 1.1 / 1.02 }, 1)];
  const st = F.strength(series, 1);
  assert(st[0].currency === 'USD' && near(st[0].pct, 2, 0.01), 'el dólar sube un 2 % frente a todas: ' + JSON.stringify(st[0]));
  const sumLog = st.reduce((a, x) => a + Math.log1p(x.pct / 100), 0);
  assert(near(sumLog, 0, 1e-9), 'la fuerza total suma cero');
  const R = U.rng(4);
  const ser = [];
  let usd = 1.1;
  for (let k = 0; k < 80; k++) ser.push(day({ USD: (usd *= Math.exp(0.004 * R.normal())), GBP: 0.85 * Math.exp(0.003 * R.normal()) }, k));
  const M = F.correlations(ser, ['EUR/USD', 'USD/CHF', 'EUR/GBP'], 60);
  assert(M[0][0] === 1 && near(M[0][1], -1, 1e-9), 'EUR/USD y USD/CHF (con EUR/CHF fijo) se mueven al revés');
  assert(near(M[0][2], M[2][0], 1e-12) && Math.abs(M[0][2]) <= 1);
});

test('Divisas: calendario económico', () => {
  const now = Date.UTC(2026, 9, 1, 12);
  const ev = [
    { title: 'Non-Farm Employment Change', country: 'USD', date: '2026-10-02T08:30:00-04:00', impact: 'High', forecast: '90K', previous: '162K' },
    { title: 'CPI Flash Estimate y/y', country: 'EUR', date: '2026-10-02T05:00:00-04:00', impact: 'High' },
    { title: 'BOJ Gov Speaks', country: 'JPY', date: '2026-10-02T02:00:00-04:00', impact: 'Medium' },
    { title: 'ISM Manufacturing PMI', country: 'USD', date: '2026-10-01T06:00:00-04:00', impact: 'High' },
  ];
  const up = F.upcoming(ev, ['USD', 'JPY'], now, {});
  assert(up.length === 2 && up[0].country === 'JPY' && up[1].title.startsWith('Non-Farm'), 'filtra por divisa, quita lo pasado y ordena');
  const r24 = F.eventRisk(ev, ['EUR', 'USD'], now, 24);
  assert(r24 && r24.length === 1 && r24[0].country === 'EUR', 'en 24 h solo el IPC europeo (el NFP llega a las 24,5 h)');
  const r36 = F.eventRisk(ev, ['EUR', 'USD'], now, 36);
  assert(r36.length === 2 && r36.every((e) => e.level === 3), 'solo alto impacto');
  assert(F.eventRisk(ev, ['JPY'], now, 24) === null);
});

test('Fuentes: Twelve Data y BCE', () => {
  const now = Date.UTC(2026, 9, 1, 12, 30);
  const body = { status: 'ok', values: [
    { datetime: '2026-10-01 12:00:00', open: '1.1330', high: '1.1340', low: '1.1320', close: '1.1335' },
    { datetime: '2026-10-01 11:00:00', open: '1.1320', high: '1.1335', low: '1.1310', close: '1.1330' },
  ] };
  const C = FEEDS.parseTwelve(body, '1h', now);
  assert(C.length === 2 && C[0].t === Date.UTC(2026, 9, 1, 11) && C[1].c === 1.1335 && C[0].closed && !C[1].closed);
  const D = FEEDS.parseTwelve({ status: 'ok', values: [{ datetime: '2026-09-30', open: '1', high: '1', low: '1', close: '1' }] }, '1d', now);
  assert(D[0].t === Date.UTC(2026, 8, 30) && D[0].closed);
  for (const [b, re] of [[{ status: 'error', code: 401, message: '**apikey** parameter is incorrect' }, /clave/], [{ status: 'error', code: 429, message: 'run out of API credits' }, /créditos/]]) {
    let msg = '';
    try {
      FEEDS.parseTwelve(b, '1h');
    } catch (e) {
      msg = e.message;
    }
    assert(re.test(msg), msg);
  }
  const ser = [
    { t: Date.UTC(2026, 8, 28), rates: { USD: 1.14, GBP: 0.86 } },
    { t: Date.UTC(2026, 8, 29), rates: { USD: 1.13, GBP: 0.855 } },
    { t: Date.UTC(2026, 8, 30), rates: { USD: 1.135, GBP: 0.857 } },
    { t: Date.UTC(2026, 9, 5), rates: { USD: 1.12, GBP: 0.85 } },
  ];
  const K = FEEDS.ecb.fixingsToCandles(ser, 'GBP/USD');
  assert(near(K[1].c, 1.13 / 0.855, 1e-12) && K[1].o === K[0].c && K[1].h === Math.max(K[1].o, K[1].c), 'cruce GBP/USD desde base EUR');
  const W = FEEDS.ecb.weekly(K, Date.UTC(2026, 9, 6));
  assert(W.length === 2 && W[0].t === Date.UTC(2026, 8, 28) && W[0].c === K[2].c && W[0].closed && !W[1].closed, 'semanas de lunes a domingo');
});

test('Análisis con datos del BCE (sin mechas ni volumen)', () => {
  const syn = U.synthetic(900, { seed: 31, intervalMs: 86400e3 });
  const ser = syn.map((k) => ({ t: k.t, rates: { USD: k.c } }));
  const C = FEEDS.ecb.fixingsToCandles(ser, 'EUR/USD');
  const ctx = SG.analyze(C, { interval: '1d' });
  assert(ctx.vwap.every((x) => Number.isNaN(x)), 'sin volumen no hay VWAP');
  const ev = SG.evaluateRange(ctx, { allowShort: true }, 0, ctx.n - 1);
  assert(ev.every((e) => Number.isFinite(e.long.score) && Number.isFinite(e.short.score)), 'puntuaciones finitas');
  assert(ev.some((e) => e.dir), 'hay señales también con datos diarios');
  assert(!ev.some((e) => e.long.reasons.concat(e.short.reasons).some((r) => r.group === 'volumen' && r.w > 0 && !/OBV|Chaikin|MFI|VWAP|Volumen/.test(r.text))), 'sin factores de volumen espurios');
});

console.log(`${passed} pruebas superadas${failed ? `, ${failed} fallidas` : ''}`);
process.exit(failed ? 1 : 0);
