/* Motor de señales: combina todas las escuelas de análisis en una
 * puntuación de confluencia para compra (largo) y venta (corto).
 *
 * Cada factor suma a un grupo (tendencia, momento, volatilidad, volumen,
 * velas, estructura, estadística, temporalidad superior). Cada grupo tiene
 * un tope: muchos osciladores diciendo lo mismo cuentan como una sola
 * evidencia, no como diez (están correlacionados). Los factores en contra
 * restan sin tope.
 *
 * Una señal exige: (1) al menos un disparador en esa vela (algo que acaba
 * de pasar, no un estado), (2) puntuación ≥ umbral del perfil, (3) ventaja
 * ≥ 1 punto sobre el lado contrario y (4) con el filtro activo, no ir
 * contra la tendencia principal. El régimen estadístico (Hurst) da más
 * peso a los disparadores de reversión en mercados antipersistentes y a
 * los de tendencia en mercados persistentes. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});
  const I = FX.ind;
  const P = FX.patterns;
  const U = FX.util;

  const GROUPS = {
    tendencia: { label: 'Tendencia', desc: 'Teoría de Dow, medias, ADX, Ichimoku, Supertrend', cap: 2 },
    multitemporal: { label: 'Temporalidad superior', desc: 'Tendencia en el marco temporal mayor', cap: 1 },
    momento: { label: 'Momento', desc: 'RSI, MACD, estocástico, CCI, divergencias', cap: 1.5 },
    volatilidad: { label: 'Volatilidad', desc: 'Bollinger, Keltner (squeeze), Donchian', cap: 1 },
    volumen: { label: 'Volumen', desc: 'OBV, MFI, Chaikin, VWAP', cap: 1 },
    velas: { label: 'Velas japonesas', desc: 'Patrones de una, dos y tres velas', cap: 1.5 },
    estructura: { label: 'Estructura y chartismo', desc: 'Soportes, resistencias, figuras, Fibonacci, BOS/CHoCH, FVG', cap: 2 },
    estadistica: { label: 'Estadística', desc: 'Pendiente de regresión significativa', cap: 0.75 },
  };

  // threshold: puntuación total mínima; minTrigger: mínimo de puntos de disparadores (lo que acaba de ocurrir).
  const PROFILES = {
    agresivo: { label: 'Agresivo', threshold: 4, minTrigger: 1.25 },
    equilibrado: { label: 'Equilibrado', threshold: 5.5, minTrigger: 2 },
    conservador: { label: 'Conservador', threshold: 6, minTrigger: 2.75 },
  };

  const DEFAULTS = { profile: 'equilibrado', trendFilter: true, mtfFilter: false, rr: 2, atrStop: 1.5, allowShort: false, decimals: null };
  const MIN_BARS = 60;
  const COOLDOWN = 3;
  const HTF = { '1m': '15m', '3m': '1h', '5m': '1h', '15m': '1h', '30m': '4h', '1h': '4h', '2h': '8h', '4h': '1d', '6h': '1d', '8h': '1d', '12h': '1d', '1d': '1w', '3d': '1w' };

  const round2 = (x) => Math.round(x * 100) / 100;
  const ok = Number.isFinite;

  function inferStep(t) {
    const d = [];
    for (let k = 1; k < Math.min(t.length, 50); k++) d.push(t[k] - t[k - 1]);
    d.sort((a, b) => a - b);
    return d.length ? d[d.length >> 1] : 3600e3;
  }

  /* Tendencia en la temporalidad superior, reconstruida agregando las velas
   * propias. Una vela superior solo cuenta cuando ha cerrado (sin mirar al futuro). */
  function higherTimeframe(S, stepMs, htfMs) {
    const n = S.n;
    const trend = new Array(n).fill(0);
    if (!htfMs || htfMs <= stepMs) return trend;
    const DAY = 86400e3;
    const WEEK = 7 * DAY;
    const startOf = (t) => (htfMs === WEEK ? Math.floor((t + 3 * DAY) / WEEK) * WEEK - 3 * DAY : Math.floor(t / htfMs) * htfMs);
    const groups = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const s = startOf(S.t[i]);
      if (!cur || s !== cur.s) {
        cur = { s, c: S.c[i], partial: S.t[i] > s, done: -1 };
        groups.push(cur);
      }
      cur.c = S.c[i];
      if (S.t[i] + stepMs >= s + htfMs) cur.done = i;
    }
    const G = groups.filter((g) => g.done >= 0 && !g.partial);
    const closes = G.map((g) => g.c);
    const e20 = I.ema(closes, 20);
    const e50 = I.ema(closes, 50);
    const gt = G.map((g, k) => {
      const c = closes[k];
      if (!ok(e20[k])) return 0;
      if (ok(e50[k])) return c > e20[k] && e20[k] > e50[k] ? 1 : c < e20[k] && e20[k] < e50[k] ? -1 : 0;
      return c > e20[k] && e20[k] > e20[k - 1] ? 1 : c < e20[k] && e20[k] < e20[k - 1] ? -1 : 0;
    });
    let g = -1;
    for (let i = 0; i < n; i++) {
      while (g + 1 < G.length && G[g + 1].done <= i) g++;
      trend[i] = g >= 0 ? gt[g] : 0;
    }
    return trend;
  }

  // Exponente de Hurst móvil (ventana de 256 rentabilidades), recalculado cada 8 velas.
  function rollingHurst(c) {
    const n = c.length;
    const out = new Array(n).fill(NaN);
    const r = FX.stats.logReturns(c);
    let last = NaN;
    for (let i = 0; i < n; i++) {
      if (i >= 256 && i % 8 === 0) last = FX.stats.hurst(r.slice(i - 256, i));
      out[i] = last;
    }
    return out;
  }

  function analyze(candles, opts) {
    opts = opts || {};
    const S = U.toSeries(candles);
    const { t, h, l, c, v } = S;
    const stepMs = (opts.interval && U.INTERVALS[opts.interval]) || inferStep(t);
    const htfName = opts.interval ? HTF[opts.interval] : null;
    const obv = I.obv(c, v);
    return {
      S, n: S.n, stepMs, interval: opts.interval || null, htf: htfName || null,
      ema20: I.ema(c, 20), ema50: I.ema(c, 50), ema200: I.ema(c, 200),
      rsi: I.rsi(c, 14), macd: I.macd(c, 12, 26, 9), stoch: I.stochastic(h, l, c, 14, 3, 3), cci: I.cci(h, l, c, 20),
      bb: I.bollinger(c, 20, 2), kc: I.keltner(h, l, c, 20, 1.5), don: I.donchian(h, l, 20), atr: I.atr(h, l, c, 14),
      adx: I.adx(h, l, c, 14), st: I.supertrend(h, l, c, 10, 3), ich: I.ichimoku(h, l, c), lr: I.linreg(c, 50),
      obv, obvEma: I.ema(obv, 20), mfi: I.mfi(h, l, c, v, 14), cmf: I.cmf(h, l, c, v, 20), vwap: I.vwap(t, h, l, c, v, stepMs),
      volSma: I.sma(v, 20),
      piv: P.pivots(S, 3, 3),
      hurst: rollingHurst(c),
      htfTrend: higherTimeframe(S, stepMs, htfName ? U.INTERVALS[htfName] : 0),
    };
  }

  // Tendencia principal: medias 50/200 (o 20/50 si aún no hay 200 velas).
  function trendAt(ctx, i) {
    const c = ctx.S.c[i];
    const f = ctx.ema50[i];
    const s = ctx.ema200[i];
    if (!ok(f)) return 0;
    if (ok(s)) return f > s && c > f ? 1 : f < s && c < f ? -1 : 0;
    const e = ctx.ema20[i];
    return e > f && c > e ? 1 : e < f && c < e ? -1 : 0;
  }

  const newSide = () => ({ score: 0, triggerScore: 0, raw: {}, trig: {}, penalty: 0, reasons: [] });
  const capped = (bag) => {
    let s = 0;
    for (const g in bag) s += Math.min(GROUPS[g].cap, bag[g]);
    return s;
  };

  function evaluate(ctx, i, opts) {
    opts = Object.assign({}, DEFAULTS, opts);
    const prof = PROFILES[opts.profile] || PROFILES.equilibrado;
    const thr = opts.threshold != null ? opts.threshold : prof.threshold;
    const minTrig = opts.minTrigger != null ? opts.minTrigger : prof.minTrigger;
    const S = ctx.S;
    const { o, h, l, c, v } = S;
    const a = ctx.atr[i];
    const fp = (x) => U.fmtPrice(x, opts.decimals);
    const res = {
      i, t: S.t[i], dir: 0, price: c[i], atr: a, threshold: thr, minTrigger: minTrig, trend: 0, htf: 0, regime: null,
      long: newSide(), short: newSide(), patterns: [], events: [], info: [], targets: [],
      levels: { supports: [], resistances: [] }, figure: null, structure: null, fib: null, snap: {},
    };
    if (i < MIN_BARS || i >= ctx.n || !(a > 0)) {
      res.note = 'Datos insuficientes para analizar';
      return res;
    }
    const Lg = res.long;
    const Sg = res.short;
    const side = (dir) => (dir > 0 ? Lg : Sg);

    // Régimen (Hurst): modula el peso de los disparadores según su naturaleza.
    const hu = ctx.hurst[i];
    res.regime = !ok(hu) ? null : hu > 0.55 ? 'persistente' : hu < 0.45 ? 'antipersistente' : 'aleatorio';
    const mult = (kind) => (res.regime === 'persistente' ? (kind === 'tf' ? 1.25 : 0.8) : res.regime === 'antipersistente' ? (kind === 'mr' ? 1.25 : 0.8) : 1);
    const add = (sd, group, w, text, trig, kind) => {
      if (w > 0 && kind) w *= mult(kind);
      w = round2(w);
      sd.reasons.push({ group, w, text, trigger: !!trig });
      if (w > 0) sd.raw[group] = (sd.raw[group] || 0) + w;
      else sd.penalty += w;
      if (trig && w > 0) sd.trig[group] = (sd.trig[group] || 0) + w;
    };
    const event = (e, group) => {
      res.events.push(e);
      add(side(e.dir), group, e.w, e.name, true, e.kind);
      if (ok(e.target)) res.targets.push({ dir: e.dir, price: e.target, label: 'Objetivo de la figura: ' + e.name.split(':')[0] });
    };
    const pv = P.recent(ctx.piv, i, 120);

    /* ----- Tendencia ----- */
    const tr = trendAt(ctx, i);
    res.trend = tr;
    const has200 = ok(ctx.ema200[i]);
    if (tr) add(side(tr), 'tendencia', 1, tr > 0 ? `Medias alineadas al alza (precio > EMA 50 > EMA ${has200 ? 200 : 20})` : `Medias alineadas a la baja (precio < EMA 50 < EMA ${has200 ? 200 : 20})`);
    const adx = ctx.adx.adx[i];
    const pdi = ctx.adx.pdi[i];
    const mdi = ctx.adx.mdi[i];
    if (adx > 25) add(side(pdi > mdi ? 1 : -1), 'tendencia', 0.5, `ADX ${adx.toFixed(0)}: tendencia con fuerza (${pdi > mdi ? '+DI > −DI' : '−DI > +DI'})`);
    const ich = ctx.ich;
    const top = Math.max(ich.senkouA[i], ich.senkouB[i]);
    const bot = Math.min(ich.senkouA[i], ich.senkouB[i]);
    if (ok(top)) {
      if (c[i] > top && ich.tenkan[i] > ich.kijun[i]) add(Lg, 'tendencia', 0.5, 'Ichimoku: precio sobre la nube y Tenkan > Kijun');
      if (c[i] < bot && ich.tenkan[i] < ich.kijun[i]) add(Sg, 'tendencia', 0.5, 'Ichimoku: precio bajo la nube y Tenkan < Kijun');
      if (ich.tenkan[i - 1] <= ich.kijun[i - 1] && ich.tenkan[i] > ich.kijun[i] && c[i] > top) add(Lg, 'tendencia', 0.75, 'Ichimoku: cruce Tenkan/Kijun alcista sobre la nube', true, 'tf');
      if (ich.tenkan[i - 1] >= ich.kijun[i - 1] && ich.tenkan[i] < ich.kijun[i] && c[i] < bot) add(Sg, 'tendencia', 0.75, 'Ichimoku: cruce Tenkan/Kijun bajista bajo la nube', true, 'tf');
      if (c[i - 1] <= Math.max(ich.senkouA[i - 1], ich.senkouB[i - 1]) && c[i] > top) add(Lg, 'tendencia', 0.75, 'Ichimoku: el precio sale de la nube por arriba', true, 'tf');
      if (c[i - 1] >= Math.min(ich.senkouA[i - 1], ich.senkouB[i - 1]) && c[i] < bot) add(Sg, 'tendencia', 0.75, 'Ichimoku: el precio sale de la nube por abajo', true, 'tf');
    }
    const sd = ctx.st.dir;
    if (sd[i] === 1) add(Lg, 'tendencia', 0.25, 'Supertrend alcista');
    if (sd[i] === -1) add(Sg, 'tendencia', 0.25, 'Supertrend bajista');
    if (sd[i - 1] === -1 && sd[i] === 1) add(Lg, 'tendencia', 0.75, 'Supertrend gira al alza', true, 'tf');
    if (sd[i - 1] === 1 && sd[i] === -1) add(Sg, 'tendencia', 0.75, 'Supertrend gira a la baja', true, 'tf');
    const st = P.structure(S, pv, i);
    res.structure = st;
    if (st.state === 1) add(Lg, 'tendencia', 0.5, 'Teoría de Dow: máximos y mínimos crecientes');
    if (st.state === -1) add(Sg, 'tendencia', 0.5, 'Teoría de Dow: máximos y mínimos decrecientes');

    /* ----- Temporalidad superior ----- */
    const ht = ctx.htfTrend[i];
    res.htf = ht;
    if (ht) {
      add(side(ht), 'multitemporal', 1, `Temporalidad superior (${ctx.htf}) ${ht > 0 ? 'alcista' : 'bajista'}`);
      add(side(-ht), 'multitemporal', -0.75, `En contra de la temporalidad superior (${ctx.htf})`);
    }

    /* ----- Momento ----- */
    const hist = ctx.macd.hist;
    if (hist[i - 1] <= 0 && hist[i] > 0) add(Lg, 'momento', 1, 'Cruce alcista del MACD' + (ctx.macd.line[i] < 0 ? ' bajo la línea cero' : ''), true, 'tf');
    if (hist[i - 1] >= 0 && hist[i] < 0) add(Sg, 'momento', 1, 'Cruce bajista del MACD' + (ctx.macd.line[i] > 0 ? ' sobre la línea cero' : ''), true, 'tf');
    const r0 = ctx.rsi[i - 1];
    const r1 = ctx.rsi[i];
    if (r0 < 30 && r1 >= 30) add(Lg, 'momento', 1, 'El RSI sale de sobreventa (30)', true, 'mr');
    if (r0 > 70 && r1 <= 70) add(Sg, 'momento', 1, 'El RSI sale de sobrecompra (70)', true, 'mr');
    if (tr === 1 && r0 < 50 && r1 >= 50) add(Lg, 'momento', 0.5, 'El RSI recupera 50 a favor de la tendencia', true, 'tf');
    if (tr === -1 && r0 > 50 && r1 <= 50) add(Sg, 'momento', 0.5, 'El RSI pierde 50 a favor de la tendencia', true, 'tf');
    if (r1 > 70) add(Lg, 'momento', -0.5, `RSI ${r1.toFixed(0)} en sobrecompra: entrada tardía`);
    if (r1 < 30) add(Sg, 'momento', -0.5, `RSI ${r1.toFixed(0)} en sobreventa: entrada tardía`);
    const K = ctx.stoch.k;
    const D = ctx.stoch.d;
    if (K[i - 1] <= D[i - 1] && K[i] > D[i] && K[i - 1] < 20) add(Lg, 'momento', 0.75, 'Cruce alcista del estocástico en sobreventa', true, 'mr');
    if (K[i - 1] >= D[i - 1] && K[i] < D[i] && K[i - 1] > 80) add(Sg, 'momento', 0.75, 'Cruce bajista del estocástico en sobrecompra', true, 'mr');
    const cc = ctx.cci;
    if (cc[i - 1] < -100 && cc[i] >= -100) add(Lg, 'momento', 0.5, 'El CCI sale de −100', true, 'mr');
    if (cc[i - 1] > 100 && cc[i] <= 100) add(Sg, 'momento', 0.5, 'El CCI sale de +100', true, 'mr');
    for (const e of P.divergences(S, pv, ctx.rsi, i, 'RSI', tr)) event(e, 'momento');
    for (const e of P.divergences(S, pv, ctx.macd.line, i, 'MACD', tr)) event(e, 'momento');

    /* ----- Volatilidad ----- */
    const bb = ctx.bb;
    const kc = ctx.kc;
    if (c[i - 1] < bb.lower[i - 1] && c[i] > bb.lower[i]) add(Lg, 'volatilidad', 0.75, 'Vuelve dentro de la banda de Bollinger inferior', true, 'mr');
    if (c[i - 1] > bb.upper[i - 1] && c[i] < bb.upper[i]) add(Sg, 'volatilidad', 0.75, 'Vuelve dentro de la banda de Bollinger superior', true, 'mr');
    const sqz = (k) => bb.upper[k] < kc.upper[k] && bb.lower[k] > kc.lower[k];
    if (sqz(i)) res.info.push('Compresión de volatilidad (Bollinger dentro de Keltner): suele preceder a un movimiento amplio.');
    if (sqz(i - 1) && !sqz(i)) {
      if (c[i] > bb.mid[i]) add(Lg, 'volatilidad', 1, 'Salida de la compresión (squeeze) al alza', true, 'tf');
      else add(Sg, 'volatilidad', 1, 'Salida de la compresión (squeeze) a la baja', true, 'tf');
    }
    const dn = ctx.don;
    if (c[i] > dn.upper[i] && c[i - 1] <= dn.upper[i - 1]) add(Lg, 'volatilidad', 0.75, 'Ruptura del canal de Donchian (máximo de 20 velas)', true, 'tf');
    if (c[i] < dn.lower[i] && c[i - 1] >= dn.lower[i - 1]) add(Sg, 'volatilidad', 0.75, 'Ruptura del canal de Donchian (mínimo de 20 velas)', true, 'tf');

    /* ----- Volumen ----- */
    const ob = ctx.obv;
    if (ob[i] > ctx.obvEma[i] && ob[i] > ob[i - 5]) add(Lg, 'volumen', 0.5, 'El OBV acompaña: acumulación');
    if (ob[i] < ctx.obvEma[i] && ob[i] < ob[i - 5]) add(Sg, 'volumen', 0.5, 'El OBV acompaña: distribución');
    const mf = ctx.mfi;
    if (mf[i - 1] < 20 && mf[i] >= 20) add(Lg, 'volumen', 0.75, 'El MFI sale de sobreventa (20)', true, 'mr');
    if (mf[i - 1] > 80 && mf[i] <= 80) add(Sg, 'volumen', 0.75, 'El MFI sale de sobrecompra (80)', true, 'mr');
    if (ctx.cmf[i] > 0.05) add(Lg, 'volumen', 0.5, `Flujo de dinero de Chaikin positivo (${ctx.cmf[i].toFixed(2)})`);
    if (ctx.cmf[i] < -0.05) add(Sg, 'volumen', 0.5, `Flujo de dinero de Chaikin negativo (${ctx.cmf[i].toFixed(2)})`);
    if (c[i] > ctx.vwap[i]) add(Lg, 'volumen', 0.25, 'Precio sobre el VWAP');
    if (c[i] < ctx.vwap[i]) add(Sg, 'volumen', 0.25, 'Precio bajo el VWAP');
    const volHigh = v[i] > 1.5 * ctx.volSma[i - 1];
    if (volHigh && c[i] > o[i]) add(Lg, 'volumen', 0.5, 'Volumen alto en vela alcista');
    if (volHigh && c[i] < o[i]) add(Sg, 'volumen', 0.5, 'Volumen alto en vela bajista');

    /* ----- Velas japonesas: el patrón más fuerte de cada lado ----- */
    const pats = P.candles(S, i, a);
    res.patterns = pats;
    for (const dir of [1, -1]) {
      const best = pats.filter((p) => p.dir === dir).sort((x, y) => y.w - x.w)[0];
      if (best) add(side(dir), 'velas', best.w, 'Vela: ' + best.name, true, 'mr');
    }

    /* ----- Estructura y chartismo ----- */
    const lv = P.levels(ctx.piv, S, i, a);
    res.levels = lv;
    const prev = P.levels(ctx.piv, S, i - 1, ctx.atr[i - 1]);
    const rz = prev.resistances[0];
    const sz = prev.supports[0];
    let broke = 0;
    if (rz && c[i] > rz.price + 0.2 * a) {
      broke = 1;
      add(Lg, 'estructura', volHigh ? 1.5 : 1, `Ruptura de la resistencia ${fp(rz.price)} (${rz.touches} toques)${volHigh ? ' con volumen' : ''}`, true, 'tf');
    }
    if (sz && c[i] < sz.price - 0.2 * a) {
      broke = -1;
      add(Sg, 'estructura', volHigh ? 1.5 : 1, `Pérdida del soporte ${fp(sz.price)} (${sz.touches} toques)${volHigh ? ' con volumen' : ''}`, true, 'tf');
    }
    const sup = lv.supports[0];
    const res0 = lv.resistances[0];
    if (broke !== 1 && sup && l[i] <= sup.price + 0.3 * a && c[i] > sup.price && c[i] > o[i]) add(Lg, 'estructura', 0.75, `Rebote en el soporte ${fp(sup.price)} (${sup.touches} toques)`, true, 'mr');
    if (broke !== -1 && res0 && h[i] >= res0.price - 0.3 * a && c[i] < res0.price && c[i] < o[i]) add(Sg, 'estructura', 0.75, `Rechazo en la resistencia ${fp(res0.price)} (${res0.touches} toques)`, true, 'mr');
    if (res0 && res0.price - c[i] < 0.75 * a) add(Lg, 'estructura', -0.75, `Resistencia muy cerca (${fp(res0.price)}): poco recorrido`);
    if (sup && c[i] - sup.price < 0.75 * a) add(Sg, 'estructura', -0.75, `Soporte muy cerca (${fp(sup.price)}): poco recorrido`);
    if (res0) res.targets.push({ dir: 1, price: res0.price, label: 'Siguiente resistencia' });
    if (sup) res.targets.push({ dir: -1, price: sup.price, label: 'Siguiente soporte' });
    for (const e of st.events) event(e, 'estructura');
    for (const e of P.doubles(S, pv, i, a)) event(e, 'estructura');
    for (const e of P.headShoulders(S, pv, i, a)) event(e, 'estructura');
    const fg = P.figures(S, pv, i, a);
    res.figure = fg.figure;
    for (const e of fg.events) event(e, 'estructura');
    for (const e of P.flags(S, i, a)) event(e, 'estructura');
    const fib = P.fibonacci(S, i, a);
    res.fib = fib;
    if (fib) {
      for (const e of fib.events) event(e, 'estructura');
      for (const x of fib.ext) if (x.e <= 1.618) res.targets.push({ dir: fib.upSwing ? 1 : -1, price: x.price, label: `Extensión de Fibonacci ${(x.e * 100).toFixed(1)} %` });
    }
    for (const e of P.fvgs(S, i, a).events) event(e, 'estructura');

    /* ----- Estadística ----- */
    const ts = ctx.lr.tstat[i];
    if (ts > 2) add(Lg, 'estadistica', 0.5, `Pendiente de regresión significativa al alza (t = ${ts.toFixed(1)})`);
    if (ts < -2) add(Sg, 'estadistica', 0.5, `Pendiente de regresión significativa a la baja (t = ${ts.toFixed(1)})`);

    /* ----- Decisión ----- */
    for (const sd of [Lg, Sg]) {
      sd.score = round2(capped(sd.raw) + sd.penalty);
      sd.triggerScore = round2(capped(sd.trig));
    }
    res.bias = round2(Lg.score - Sg.score);
    let dir = 0;
    if (Lg.triggerScore >= minTrig && Lg.score >= thr && Lg.score - Sg.score >= 1) dir = 1;
    else if (Sg.triggerScore >= minTrig && Sg.score >= thr && Sg.score - Lg.score >= 1) dir = -1;
    if (dir && opts.trendFilter && tr === -dir) {
      res.blocked = `Señal de ${dir > 0 ? 'compra' : 'venta'} descartada: va contra la tendencia principal (filtro de tendencia activo).`;
      dir = 0;
    }
    if (dir && opts.mtfFilter && ht === -dir) {
      res.blocked = `Señal de ${dir > 0 ? 'compra' : 'venta'} descartada: va contra la temporalidad superior (${ctx.htf}).`;
      dir = 0;
    }
    res.candidate = dir;
    if (dir === -1 && !opts.allowShort) res.spotNote = 'En spot no se puede vender en corto: úsala para cerrar o reducir compras.';

    if (dir) {
      const entry = c[i];
      let stop = entry - dir * opts.atrStop * a;
      let kind = `${opts.atrStop} × ATR`;
      const ext = dir > 0 ? I.lowest(l, 5, i) - 0.2 * a : I.highest(h, 5, i) + 0.2 * a;
      const dist = dir * (entry - ext);
      if (dist >= 0.8 * a && dist <= 3 * a) {
        stop = ext;
        kind = 'extremo de las últimas 5 velas';
      }
      const risk = Math.abs(entry - stop);
      Object.assign(res, { dir, entry, stop, target: entry + dir * opts.rr * risk, rr: opts.rr, stopKind: kind, riskPct: (risk / entry) * 100 });
    }
    res.score = dir > 0 ? Lg.score : dir < 0 ? Sg.score : Math.max(Lg.score, Sg.score);
    res.strength = !dir ? '' : res.score >= thr + 2 ? 'alta' : res.score >= thr + 1 ? 'media' : 'justa';
    // Objetivos técnicos en la dirección de la señal (o del sesgo), más allá del precio.
    const d0 = dir || Math.sign(res.bias) || 1;
    res.targets = res.targets.filter((x) => x.dir === d0 && d0 * (x.price - c[i]) > 0.25 * a).sort((x, y) => d0 * (x.price - y.price));

    res.snap = {
      rsi: r1, macdHist: hist[i], adx, stochK: K[i], cci: cc[i], mfi: mf[i], cmf: ctx.cmf[i],
      atrPct: (a / c[i]) * 100, pctB: (c[i] - bb.lower[i]) / (bb.upper[i] - bb.lower[i]), vwap: ctx.vwap[i],
      supertrend: sd[i], ichimoku: !ok(top) ? 0 : c[i] > top ? 1 : c[i] < bot ? -1 : 0, hurst: hu, tstat: ts,
      ema20: ctx.ema20[i], ema50: ctx.ema50[i], ema200: ctx.ema200[i],
    };
    return res;
  }

  function evaluateRange(ctx, opts, from, to) {
    const out = [];
    for (let i = Math.max(from, MIN_BARS); i <= to; i++) out.push(evaluate(ctx, i, opts));
    return out;
  }

  // ¿Es la señal de la vela k "nueva"? (sin otra del mismo sentido en las COOLDOWN velas previas)
  function isFresh(evals, k) {
    const e = evals[k];
    if (!e || !e.dir) return false;
    for (let j = k - 1; j >= Math.max(0, k - COOLDOWN); j--) if (evals[j].dir === e.dir) return false;
    return true;
  }

  function freshAt(ctx, i, opts) {
    const evs = evaluateRange(ctx, opts, i - COOLDOWN, i);
    return isFresh(evs, evs.length - 1) ? evs[evs.length - 1] : null;
  }

  FX.signals = { GROUPS, PROFILES, DEFAULTS, MIN_BARS, COOLDOWN, HTF, analyze, trendAt, evaluate, evaluateRange, isFresh, freshAt, higherTimeframe };
})(typeof globalThis !== 'undefined' ? globalThis : this);
