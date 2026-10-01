/* Reconocimiento de patrones: velas japonesas, pivotes (máximos y mínimos
 * de oscilación), soportes y resistencias, figuras chartistas, Fibonacci,
 * puntos pivote, estructura de mercado (teoría de Dow / BOS-CHoCH), huecos
 * de valor (FVG) y divergencias.
 *
 * Causalidad: un pivote en la vela k solo se conoce cuando han pasado
 * `right` velas (campo `at`). Todas las funciones que reciben un índice i
 * usan únicamente pivotes con at <= i, así que nada mira al futuro. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});
  const { highest, lowest } = FX.ind;

  const NAMES = {
    hammer: 'Martillo',
    hangingMan: 'Hombre colgado',
    shootingStar: 'Estrella fugaz',
    invertedHammer: 'Martillo invertido',
    doji: 'Doji (indecisión)',
    bullEngulfing: 'Envolvente alcista',
    bearEngulfing: 'Envolvente bajista',
    piercing: 'Línea penetrante',
    darkCloud: 'Cubierta de nube oscura',
    bullHarami: 'Harami alcista',
    bearHarami: 'Harami bajista',
    morningStar: 'Estrella de la mañana',
    eveningStar: 'Estrella del atardecer',
    threeSoldiers: 'Tres soldados blancos',
    threeCrows: 'Tres cuervos negros',
    tweezerBottom: 'Pinzas de suelo',
    tweezerTop: 'Pinzas de techo',
  };

  // Tendencia de las n velas previas a la vela i, medida en ATR: 1, 0 o -1.
  function priorTrend(c, i, atr, n) {
    n = n || 5;
    if (i - 1 - n < 0) return 0;
    const d = c[i - 1] - c[i - 1 - n];
    return d > 0.5 * atr ? 1 : d < -0.5 * atr ? -1 : 0;
  }

  /* ---------- Velas japonesas (Nison) ---------- */
  function candles(S, i, atr) {
    const out = [];
    if (i < 8 || !(atr > 0)) return out;
    const { o, h, l, c } = S;
    const B = (k) => Math.abs(c[k] - o[k]);
    const R = (k) => h[k] - l[k];
    const up = (k) => c[k] > o[k];
    const dn = (k) => c[k] < o[k];
    const upper = (k) => h[k] - Math.max(o[k], c[k]);
    const lower = (k) => Math.min(o[k], c[k]) - l[k];
    const mid = (k) => (o[k] + c[k]) / 2;
    const add = (key, dir, w) => out.push({ key, name: NAMES[key], dir, w, i });
    const tr = priorTrend(c, i, atr);
    const tr3 = priorTrend(c, i - 2, atr);
    const r = R(i);
    const b = B(i);

    // Una vela
    let single = false;
    if (r > 0.6 * atr) {
      if (lower(i) >= 2 * b && lower(i) >= 0.55 * r && upper(i) <= 0.15 * r) {
        if (tr === -1) add('hammer', 1, 1);
        else if (tr === 1) add('hangingMan', -1, 0.5);
        single = tr !== 0;
      } else if (upper(i) >= 2 * b && upper(i) >= 0.55 * r && lower(i) <= 0.15 * r) {
        if (tr === 1) add('shootingStar', -1, 1);
        else if (tr === -1) add('invertedHammer', 1, 0.5);
        single = tr !== 0;
      }
    }
    if (!single && r > 0.3 * atr && b <= 0.1 * r) add('doji', 0, 0);

    // Dos velas
    if (tr === -1 && dn(i - 1) && up(i) && o[i] <= c[i - 1] && c[i] >= o[i - 1] && b > B(i - 1) && b > 0.3 * atr) add('bullEngulfing', 1, 1.25);
    if (tr === 1 && up(i - 1) && dn(i) && o[i] >= c[i - 1] && c[i] <= o[i - 1] && b > B(i - 1) && b > 0.3 * atr) add('bearEngulfing', -1, 1.25);
    if (tr === -1 && dn(i - 1) && B(i - 1) > 0.6 * atr && up(i) && o[i] <= c[i - 1] && c[i] > mid(i - 1) && c[i] < o[i - 1]) add('piercing', 1, 1);
    if (tr === 1 && up(i - 1) && B(i - 1) > 0.6 * atr && dn(i) && o[i] >= c[i - 1] && c[i] < mid(i - 1) && c[i] > o[i - 1]) add('darkCloud', -1, 1);
    if (tr === -1 && dn(i - 1) && B(i - 1) > 0.8 * atr && up(i) && b < 0.5 * B(i - 1) && o[i] >= c[i - 1] && c[i] <= o[i - 1]) add('bullHarami', 1, 0.5);
    if (tr === 1 && up(i - 1) && B(i - 1) > 0.8 * atr && dn(i) && b < 0.5 * B(i - 1) && o[i] <= c[i - 1] && c[i] >= o[i - 1]) add('bearHarami', -1, 0.5);
    if (tr === -1 && dn(i - 1) && up(i) && Math.abs(l[i] - l[i - 1]) <= 0.1 * atr && B(i - 1) > 0.4 * atr) add('tweezerBottom', 1, 0.75);
    if (tr === 1 && up(i - 1) && dn(i) && Math.abs(h[i] - h[i - 1]) <= 0.1 * atr && B(i - 1) > 0.4 * atr) add('tweezerTop', -1, 0.75);

    // Tres velas
    if (tr3 === -1 && dn(i - 2) && B(i - 2) > 0.8 * atr && B(i - 1) < 0.35 * B(i - 2) && up(i) && c[i] > mid(i - 2) && b > 0.4 * B(i - 2)) add('morningStar', 1, 1.5);
    if (tr3 === 1 && up(i - 2) && B(i - 2) > 0.8 * atr && B(i - 1) < 0.35 * B(i - 2) && dn(i) && c[i] < mid(i - 2) && b > 0.4 * B(i - 2)) add('eveningStar', -1, 1.5);
    const soldiers = [i - 2, i - 1, i].every((k, j) => up(k) && B(k) > 0.5 * atr && upper(k) < 0.35 * B(k) && (j === 0 || (c[k] > c[k - 1] && o[k] >= o[k - 1] && o[k] <= c[k - 1])));
    if (tr3 <= 0 && soldiers) add('threeSoldiers', 1, 1.25);
    const crows = [i - 2, i - 1, i].every((k, j) => dn(k) && B(k) > 0.5 * atr && lower(k) < 0.35 * B(k) && (j === 0 || (c[k] < c[k - 1] && o[k] <= o[k - 1] && o[k] >= c[k - 1])));
    if (tr3 >= 0 && crows) add('threeCrows', -1, 1.25);
    return out;
  }

  /* ---------- Pivotes ---------- */
  function pivots(S, left, right) {
    left = left || 3;
    right = right || 3;
    const { h, l } = S;
    const n = h.length;
    const out = [];
    for (let i = left; i < n - right; i++) {
      let isH = true;
      let isL = true;
      for (let k = 1; k <= left; k++) {
        if (!(h[i] > h[i - k])) isH = false;
        if (!(l[i] < l[i - k])) isL = false;
      }
      for (let k = 1; k <= right; k++) {
        if (!(h[i] >= h[i + k])) isH = false;
        if (!(l[i] <= l[i + k])) isL = false;
      }
      if (isH) out.push({ i, type: 'H', price: h[i], at: i + right });
      if (isL) out.push({ i, type: 'L', price: l[i], at: i + right });
    }
    return out;
  }

  // Número de pivotes ya confirmados en la vela i (búsqueda binaria: `at` es creciente).
  function confirmed(piv, i) {
    let lo = 0;
    let hi = piv.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (piv[m].at <= i) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  // Pivotes confirmados en i cuyo extremo está dentro de las últimas `lookback` velas, en orden temporal.
  function recent(piv, i, lookback) {
    const end = confirmed(piv, i);
    let s = end;
    while (s > 0 && piv[s - 1].i >= i - lookback) s--;
    return piv.slice(s, end);
  }

  const lastOf = (arr, type, k) => arr.filter((p) => p.type === type).slice(-(k || 2));

  /* ---------- Soportes y resistencias ---------- */
  // Agrupa los pivotes por precio; un nivel necesita al menos dos toques.
  function levels(piv, S, i, atr, lookback) {
    const pts = recent(piv, i, lookback || 150).slice().sort((a, b) => a.price - b.price);
    const tol = 0.5 * atr;
    const cl = [];
    for (const p of pts) {
      const z = cl[cl.length - 1];
      if (z && p.price - z.mean <= tol) {
        z.sum += p.price;
        z.n++;
        z.mean = z.sum / z.n;
        z.last = Math.max(z.last, p.i);
      } else cl.push({ sum: p.price, n: 1, mean: p.price, last: p.i });
    }
    const close = S.c[i];
    const zones = cl.filter((z) => z.n >= 2).map((z) => ({ price: z.mean, touches: z.n, last: z.last }));
    return {
      supports: zones.filter((z) => z.price < close).sort((a, b) => b.price - a.price),
      resistances: zones.filter((z) => z.price >= close).sort((a, b) => a.price - b.price),
    };
  }

  /* ---------- Teoría de Dow / estructura de mercado ---------- */
  function structure(S, pv, i) {
    const H = lastOf(pv, 'H');
    const L = lastOf(pv, 'L');
    const res = { state: 0, label: 'Sin estructura clara', events: [], lastHigh: H[H.length - 1], lastLow: L[L.length - 1] };
    if (H.length < 2 || L.length < 2) return res;
    const hh = H[1].price > H[0].price;
    const hl = L[1].price > L[0].price;
    if (hh && hl) {
      res.state = 1;
      res.label = 'Máximos y mínimos crecientes';
    } else if (!hh && !hl) {
      res.state = -1;
      res.label = 'Máximos y mínimos decrecientes';
    } else res.label = 'Estructura lateral';
    const c = S.c;
    const sh = H[1].price;
    const sl = L[1].price;
    if (c[i] > sh && c[i - 1] <= sh) {
      if (res.state === 1) res.events.push({ key: 'bos', dir: 1, w: 0.75, name: 'Ruptura de estructura alcista (BOS): supera el último máximo', kind: 'tf' });
      else if (res.state === -1) res.events.push({ key: 'choch', dir: 1, w: 1, name: 'Cambio de carácter alcista (CHoCH): rompe el último máximo decreciente', kind: 'mr' });
      else res.events.push({ key: 'bos', dir: 1, w: 0.5, name: 'Supera el último máximo de oscilación', kind: 'tf' });
    }
    if (c[i] < sl && c[i - 1] >= sl) {
      if (res.state === -1) res.events.push({ key: 'bos', dir: -1, w: 0.75, name: 'Ruptura de estructura bajista (BOS): pierde el último mínimo', kind: 'tf' });
      else if (res.state === 1) res.events.push({ key: 'choch', dir: -1, w: 1, name: 'Cambio de carácter bajista (CHoCH): pierde el último mínimo creciente', kind: 'mr' });
      else res.events.push({ key: 'bos', dir: -1, w: 0.5, name: 'Pierde el último mínimo de oscilación', kind: 'tf' });
    }
    return res;
  }

  /* ---------- Figuras chartistas ---------- */
  // Doble suelo / doble techo, confirmados al romper la línea clavicular.
  function doubles(S, pv, i, atr) {
    const out = [];
    const c = S.c;
    const L = lastOf(pv, 'L');
    const H = lastOf(pv, 'H');
    const highs = pv.filter((p) => p.type === 'H');
    const lows = pv.filter((p) => p.type === 'L');
    if (L.length === 2) {
      const [a, b] = L;
      const mids = highs.filter((p) => p.i > a.i && p.i < b.i);
      if (b.i - a.i >= 5 && Math.abs(a.price - b.price) <= 0.6 * atr && mids.length && i - b.i <= 40) {
        const neck = Math.max(...mids.map((p) => p.price));
        const height = neck - Math.min(a.price, b.price);
        if (height >= 1.5 * atr && c[i] > neck && c[i - 1] <= neck) out.push({ key: 'doubleBottom', dir: 1, w: 1.5, name: 'Doble suelo confirmado (rompe la línea clavicular)', target: neck + height, kind: 'mr' });
      }
    }
    if (H.length === 2) {
      const [a, b] = H;
      const mids = lows.filter((p) => p.i > a.i && p.i < b.i);
      if (b.i - a.i >= 5 && Math.abs(a.price - b.price) <= 0.6 * atr && mids.length && i - b.i <= 40) {
        const neck = Math.min(...mids.map((p) => p.price));
        const height = Math.max(a.price, b.price) - neck;
        if (height >= 1.5 * atr && c[i] < neck && c[i - 1] >= neck) out.push({ key: 'doubleTop', dir: -1, w: 1.5, name: 'Doble techo confirmado (pierde la línea clavicular)', target: neck - height, kind: 'mr' });
      }
    }
    return out;
  }

  const lineThrough = (p1, p2) => (x) => p1.price + ((p2.price - p1.price) * (x - p1.i)) / (p2.i - p1.i);

  // Hombro-cabeza-hombro (HCH) y su versión invertida.
  function headShoulders(S, pv, i, atr) {
    const out = [];
    const c = S.c;
    const check = (type) => {
      const P = lastOf(pv, type, 3);
      if (P.length < 3) return;
      const [a, b, d] = P;
      const s = type === 'H' ? 1 : -1; // 1: HCH (techo), -1: invertido (suelo)
      const head = s * b.price > s * a.price && s * b.price > s * d.price;
      const shoulders = Math.abs(a.price - d.price) <= 1.5 * atr;
      const prominent = s * (b.price - (s > 0 ? Math.max(a.price, d.price) : Math.min(a.price, d.price))) >= 1 * atr;
      if (!head || !shoulders || !prominent || i - d.i > 30) return;
      const other = type === 'H' ? 'L' : 'H';
      const pick = (from, to) => {
        const xs = pv.filter((p) => p.type === other && p.i > from && p.i < to);
        if (!xs.length) return null;
        return xs.reduce((m, p) => (s > 0 ? (p.price < m.price ? p : m) : p.price > m.price ? p : m));
      };
      const n1 = pick(a.i, b.i);
      const n2 = pick(b.i, d.i);
      if (!n1 || !n2) return;
      const neck = lineThrough(n1, n2);
      const height = Math.abs(b.price - neck(b.i));
      const tol = 0.1 * atr;
      if (s > 0 && c[i] < neck(i) - tol && c[i - 1] >= neck(i - 1) - tol) out.push({ key: 'hs', dir: -1, w: 1.5, name: 'Hombro-cabeza-hombro: pierde la línea clavicular', target: neck(i) - height, kind: 'mr' });
      if (s < 0 && c[i] > neck(i) + tol && c[i - 1] <= neck(i - 1) + tol) out.push({ key: 'ihs', dir: 1, w: 1.5, name: 'Hombro-cabeza-hombro invertido: supera la línea clavicular', target: neck(i) + height, kind: 'mr' });
    };
    check('H');
    check('L');
    return out;
  }

  /* Triángulos, cuñas y canales a partir de las dos últimas directrices
   * (recta por los dos últimos máximos y por los dos últimos mínimos). */
  function figures(S, pv, i, atr) {
    const H = lastOf(pv, 'H');
    const L = lastOf(pv, 'L');
    if (H.length < 2 || L.length < 2) return { figure: null, events: [] };
    const start = Math.min(H[0].i, L[0].i);
    const lastPiv = Math.max(H[1].i, L[1].i);
    if (lastPiv - start < 10 || i - lastPiv > 40) return { figure: null, events: [] };
    const up = lineThrough(H[0], H[1]);
    const lo = lineThrough(L[0], L[1]);
    const dU = (up(i) - up(start)) / atr;
    const dL = (lo(i) - lo(start)) / atr;
    const w0 = up(start) - lo(start);
    const w1 = up(i) - lo(i);
    if (!(w0 > 0 && w1 > 0)) return { figure: null, events: [] };
    const conv = w1 < 0.7 * w0;
    const para = Math.abs(w1 - w0) < 0.25 * w0;
    const flat = (d) => Math.abs(d) < 0.6;
    let f = null;
    if (conv && flat(dU) && dL > 0.6) f = { key: 'ascTriangle', name: 'Triángulo ascendente', bias: 1 };
    else if (conv && flat(dL) && dU < -0.6) f = { key: 'descTriangle', name: 'Triángulo descendente', bias: -1 };
    else if (conv && dU < -0.6 && dL > 0.6) f = { key: 'symTriangle', name: 'Triángulo simétrico', bias: 0 };
    else if (conv && dU > 0.6 && dL > 0.6) f = { key: 'risingWedge', name: 'Cuña ascendente', bias: -1 };
    else if (conv && dU < -0.6 && dL < -0.6) f = { key: 'fallingWedge', name: 'Cuña descendente', bias: 1 };
    else if (para && dU > 0.6 && dL > 0.6) f = { key: 'upChannel', name: 'Canal alcista', bias: 1, channel: true };
    else if (para && dU < -0.6 && dL < -0.6) f = { key: 'downChannel', name: 'Canal bajista', bias: -1, channel: true };
    else if (para && flat(dU) && flat(dL)) f = { key: 'range', name: 'Rango lateral', bias: 0, channel: true };
    if (!f) return { figure: null, events: [] };
    const c = S.c;
    const tol = 0.25 * atr;
    for (let k = lastPiv + 1; k < i; k++) if (c[k] > up(k) + tol || c[k] < lo(k) - tol) return { figure: null, events: [] };
    f.upper = { i1: H[0].i, p1: H[0].price, i2: i, p2: up(i) };
    f.lower = { i1: L[0].i, p1: L[0].price, i2: i, p2: lo(i) };
    const events = [];
    const b = 0.1 * atr;
    const wOf = (dir) => (f.bias === dir ? 1.25 : f.bias === 0 ? 1 : 0.75);
    if (c[i] > up(i) + b && c[i - 1] <= up(i - 1) + b) events.push({ key: 'figBreakUp', dir: 1, w: wOf(1), name: f.name + ': ruptura al alza', target: c[i] + w0, kind: 'tf' });
    else if (c[i] < lo(i) - b && c[i - 1] >= lo(i - 1) - b) events.push({ key: 'figBreakDn', dir: -1, w: wOf(-1), name: f.name + ': ruptura a la baja', target: c[i] - w0, kind: 'tf' });
    else if (f.channel) {
      const { o, l, h } = S;
      if (f.bias >= 0 && l[i] <= lo(i) + 0.2 * atr && c[i] > lo(i) && c[i] > o[i]) events.push({ key: 'chanBounce', dir: 1, w: 0.75, name: f.name + ': rebote en la directriz inferior', kind: 'mr' });
      if (f.bias <= 0 && h[i] >= up(i) - 0.2 * atr && c[i] < up(i) && c[i] < o[i]) events.push({ key: 'chanReject', dir: -1, w: 0.75, name: f.name + ': rechazo en la directriz superior', kind: 'mr' });
    }
    return { figure: f, events };
  }

  // Banderas y banderines: impulso fuerte, pausa estrecha y ruptura a favor del impulso.
  function flags(S, i, atr) {
    const { h, l, c } = S;
    for (let m = 4; m <= 12; m++) {
      const pe = i - m - 1;
      const ps = pe - 8;
      if (ps < 0) break;
      const pole = c[pe] - c[ps];
      if (Math.abs(pole) < 3 * atr) continue;
      const hi = highest(h, m, i - 1);
      const lo = lowest(l, m, i - 1);
      if (hi - lo > 0.5 * Math.abs(pole)) continue;
      if (pole > 0 && lo > c[pe] - 0.5 * pole && c[i] > hi && c[i - 1] <= hi) return [{ key: 'bullFlag', dir: 1, w: 1.25, name: 'Bandera alcista: ruptura tras la pausa', target: c[i] + pole, kind: 'tf' }];
      if (pole < 0 && hi < c[pe] - 0.5 * pole && c[i] < lo && c[i - 1] >= lo) return [{ key: 'bearFlag', dir: -1, w: 1.25, name: 'Bandera bajista: ruptura tras la pausa', target: c[i] + pole, kind: 'tf' }];
    }
    return [];
  }

  /* ---------- Divergencias (RSI y MACD) ---------- */
  function divergences(S, pv, osc, i, label, trend) {
    const out = [];
    const L = lastOf(pv, 'L');
    const H = lastOf(pv, 'H');
    if (L.length === 2) {
      const [a, b] = L;
      if (i - b.at <= 2 && b.i - a.i >= 5 && b.i - a.i <= 60 && Number.isFinite(osc[a.i]) && Number.isFinite(osc[b.i])) {
        const tol = label === 'RSI' ? 3 : 0;
        if (b.price < a.price && osc[b.i] > osc[a.i] + tol && (label !== 'RSI' || osc[a.i] < 40)) out.push({ key: 'bullDiv', dir: 1, w: 1.25, name: `Divergencia alcista en ${label} (precio con mínimo más bajo, ${label} no)`, kind: 'mr' });
        else if (trend === 1 && b.price > a.price && osc[b.i] < osc[a.i] - tol) out.push({ key: 'hiddenBullDiv', dir: 1, w: 0.75, name: `Divergencia oculta alcista en ${label} (continuación)`, kind: 'tf' });
      }
    }
    if (H.length === 2) {
      const [a, b] = H;
      if (i - b.at <= 2 && b.i - a.i >= 5 && b.i - a.i <= 60 && Number.isFinite(osc[a.i]) && Number.isFinite(osc[b.i])) {
        const tol = label === 'RSI' ? 3 : 0;
        if (b.price > a.price && osc[b.i] < osc[a.i] - tol && (label !== 'RSI' || osc[a.i] > 60)) out.push({ key: 'bearDiv', dir: -1, w: 1.25, name: `Divergencia bajista en ${label} (precio con máximo más alto, ${label} no)`, kind: 'mr' });
        else if (trend === -1 && b.price < a.price && osc[b.i] > osc[a.i] + tol) out.push({ key: 'hiddenBearDiv', dir: -1, w: 0.75, name: `Divergencia oculta bajista en ${label} (continuación)`, kind: 'tf' });
      }
    }
    return out;
  }

  /* ---------- Fibonacci ---------- */
  const RETR = [0.236, 0.382, 0.5, 0.618, 0.786];
  const EXT = [1.272, 1.618, 2.618];
  function fibonacci(S, i, atr, lookback) {
    lookback = lookback || 120;
    const { h, l, c, o } = S;
    const s = Math.max(0, i - lookback + 1);
    let hiI = s;
    let loI = s;
    for (let k = s; k <= i; k++) {
      if (h[k] > h[hiI]) hiI = k;
      if (l[k] < l[loI]) loI = k;
    }
    const hi = h[hiI];
    const lo = l[loI];
    const range = hi - lo;
    if (!(range >= 4 * atr)) return null;
    const upSwing = loI < hiI;
    const at = (r) => (upSwing ? hi - r * range : lo + r * range);
    const ext = (e) => (upSwing ? lo + e * range : hi - e * range);
    const fib = {
      upSwing, hi, lo, hiI, loI,
      retr: RETR.map((r) => ({ r, price: at(r) })),
      ext: EXT.map((e) => ({ e, price: ext(e) })),
      events: [],
    };
    const fromExtreme = upSwing ? i - hiI : i - loI;
    if (fromExtreme >= 2) {
      if (upSwing && l[i] <= at(0.382) + 0.1 * atr && l[i] >= at(0.786) - 0.2 * atr && c[i] > at(0.618) && c[i] > o[i]) fib.events.push({ key: 'fibBounce', dir: 1, w: 0.75, name: 'Rebote en la zona de retroceso de Fibonacci (38.2–61.8 %)', kind: 'mr' });
      if (!upSwing && h[i] >= at(0.382) - 0.1 * atr && h[i] <= at(0.786) + 0.2 * atr && c[i] < at(0.618) && c[i] < o[i]) fib.events.push({ key: 'fibReject', dir: -1, w: 0.75, name: 'Rechazo en la zona de retroceso de Fibonacci (38.2–61.8 %)', kind: 'mr' });
    }
    return fib;
  }

  /* ---------- Puntos pivote clásicos ---------- */
  // Diarios en gráficos ≤ 1h, semanales hasta 4h y mensuales por encima.
  function pivotPoints(S, i, stepMs) {
    const DAY = 86400e3;
    const period = stepMs <= 3600e3 ? 'día' : stepMs <= 14400e3 ? 'semana' : 'mes';
    const key = (t) => {
      if (period === 'día') return Math.floor(t / DAY);
      if (period === 'semana') return Math.floor((t + 3 * DAY) / (7 * DAY));
      const d = new Date(t);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    };
    const cur = key(S.t[i]);
    let k = i;
    while (k >= 0 && key(S.t[k]) === cur) k--;
    if (k < 0) return null;
    const prev = key(S.t[k]);
    let H = -Infinity;
    let L = Infinity;
    const C = S.c[k];
    let j = k;
    while (j >= 0 && key(S.t[j]) === prev) {
      H = Math.max(H, S.h[j]);
      L = Math.min(L, S.l[j]);
      j--;
    }
    const P = (H + L + C) / 3;
    return {
      period, partial: j < 0,
      P, R1: 2 * P - L, S1: 2 * P - H, R2: P + (H - L), S2: P - (H - L), R3: H + 2 * (P - L), S3: L - 2 * (H - P),
    };
  }

  /* ---------- Huecos de valor (Fair Value Gaps) ---------- */
  function fvgs(S, i, atr, lookback) {
    lookback = lookback || 60;
    const { h, l, c, o } = S;
    const gaps = [];
    for (let k = Math.max(2, i - lookback); k < i - 1; k++) {
      if (l[k] - h[k - 2] > 0.3 * atr) {
        let top = l[k];
        const bottom = h[k - 2];
        for (let j = k + 1; j < i && top > bottom; j++) top = Math.min(top, l[j]);
        if (top > bottom) gaps.push({ dir: 1, top, bottom, k });
      }
      if (l[k - 2] - h[k] > 0.3 * atr) {
        const top = l[k - 2];
        let bottom = h[k];
        for (let j = k + 1; j < i && top > bottom; j++) bottom = Math.max(bottom, h[j]);
        if (top > bottom) gaps.push({ dir: -1, top, bottom, k });
      }
    }
    const events = [];
    for (const g of gaps) {
      if (g.dir === 1 && l[i] <= g.top && c[i] > g.bottom && c[i] > o[i] && !events.some((e) => e.dir === 1)) events.push({ key: 'fvgBull', dir: 1, w: 0.5, name: 'Reacción en un hueco de valor alcista (FVG)', kind: 'mr' });
      if (g.dir === -1 && h[i] >= g.bottom && c[i] < g.top && c[i] < o[i] && !events.some((e) => e.dir === -1)) events.push({ key: 'fvgBear', dir: -1, w: 0.5, name: 'Reacción en un hueco de valor bajista (FVG)', kind: 'mr' });
    }
    return { gaps, events };
  }

  FX.patterns = {
    NAMES, priorTrend, candles, pivots, confirmed, recent, levels, structure, doubles, headShoulders, figures, flags,
    divergences, fibonacci, pivotPoints, fvgs,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
