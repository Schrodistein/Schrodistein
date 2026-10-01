/* Indicadores técnicos. Todas las funciones son causales: el valor en el
 * índice i solo depende de datos hasta i (nunca mira al futuro), así que se
 * pueden usar tal cual en el backtest. Devuelven arrays de la misma longitud
 * que la entrada, con NaN donde todavía no hay datos suficientes. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});

  const blank = (n) => new Array(n).fill(NaN);
  const ok = Number.isFinite;
  function firstFinite(a) {
    for (let i = 0; i < a.length; i++) if (ok(a[i])) return i;
    return a.length;
  }

  /* ---------- Medias ---------- */
  function sma(src, p) {
    const n = src.length;
    const out = blank(n);
    const s = firstFinite(src);
    let sum = 0;
    for (let i = s; i < n; i++) {
      sum += src[i];
      if (i - s >= p) sum -= src[i - p];
      if (i - s >= p - 1) out[i] = sum / p;
    }
    return out;
  }

  // Suavizado exponencial sembrado con la media simple de los primeros p valores.
  function smooth(src, p, k) {
    const n = src.length;
    const out = blank(n);
    const s = firstFinite(src);
    if (s + p > n) return out;
    let prev = 0;
    for (let i = s; i < s + p; i++) prev += src[i];
    prev /= p;
    out[s + p - 1] = prev;
    for (let i = s + p; i < n; i++) {
      prev += (src[i] - prev) * k;
      out[i] = prev;
    }
    return out;
  }
  const ema = (src, p) => smooth(src, p, 2 / (p + 1));
  const rma = (src, p) => smooth(src, p, 1 / p); // media de Wilder

  function highest(src, p, i) {
    let m = -Infinity;
    for (let k = Math.max(0, i - p + 1); k <= i; k++) if (src[k] > m) m = src[k];
    return m;
  }
  function lowest(src, p, i) {
    let m = Infinity;
    for (let k = Math.max(0, i - p + 1); k <= i; k++) if (src[k] < m) m = src[k];
    return m;
  }

  /* ---------- Momento ---------- */
  function rsi(close, p) {
    p = p || 14;
    const n = close.length;
    const gain = blank(n);
    const loss = blank(n);
    for (let i = 1; i < n; i++) {
      const d = close[i] - close[i - 1];
      gain[i] = d > 0 ? d : 0;
      loss[i] = d < 0 ? -d : 0;
    }
    const ag = rma(gain, p);
    const al = rma(loss, p);
    const out = blank(n);
    for (let i = 0; i < n; i++) {
      if (!ok(ag[i])) continue;
      out[i] = al[i] === 0 ? (ag[i] === 0 ? 50 : 100) : 100 - 100 / (1 + ag[i] / al[i]);
    }
    return out;
  }

  function macd(close, fast, slow, sig) {
    const ef = ema(close, fast || 12);
    const es = ema(close, slow || 26);
    const line = ef.map((v, i) => v - es[i]);
    const signal = ema(line, sig || 9);
    const hist = line.map((v, i) => v - signal[i]);
    return { line, signal, hist };
  }

  function stochastic(h, l, c, p, ks, ds) {
    p = p || 14;
    const n = c.length;
    const raw = blank(n);
    for (let i = p - 1; i < n; i++) {
      const hh = highest(h, p, i);
      const ll = lowest(l, p, i);
      raw[i] = hh === ll ? 50 : (100 * (c[i] - ll)) / (hh - ll);
    }
    const k = sma(raw, ks || 3);
    return { k, d: sma(k, ds || 3) };
  }

  // Commodity Channel Index (Lambert): desviación del precio típico respecto a su media.
  function cci(h, l, c, p) {
    p = p || 20;
    const n = c.length;
    const tp = c.map((x, i) => (h[i] + l[i] + x) / 3);
    const m = sma(tp, p);
    const out = blank(n);
    for (let i = p - 1; i < n; i++) {
      let md = 0;
      for (let k = i - p + 1; k <= i; k++) md += Math.abs(tp[k] - m[i]);
      md /= p;
      out[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md);
    }
    return out;
  }

  /* ---------- Volatilidad ---------- */
  function trueRange(h, l, c) {
    return c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  }
  const atr = (h, l, c, p) => rma(trueRange(h, l, c), p || 14);

  function bollinger(close, p, mult) {
    p = p || 20;
    mult = mult || 2;
    const n = close.length;
    const mid = sma(close, p);
    const upper = blank(n);
    const lower = blank(n);
    const width = blank(n);
    for (let i = p - 1; i < n; i++) {
      let v = 0;
      for (let k = i - p + 1; k <= i; k++) v += (close[k] - mid[i]) ** 2;
      const sd = Math.sqrt(v / p);
      upper[i] = mid[i] + mult * sd;
      lower[i] = mid[i] - mult * sd;
      width[i] = mid[i] ? (upper[i] - lower[i]) / mid[i] : NaN;
    }
    return { mid, upper, lower, width };
  }

  function keltner(h, l, c, p, mult) {
    p = p || 20;
    mult = mult || 1.5;
    const mid = ema(c, p);
    const a = atr(h, l, c, p);
    return { mid, upper: mid.map((m, i) => m + mult * a[i]), lower: mid.map((m, i) => m - mult * a[i]) };
  }

  // Canal de Donchian (máximo y mínimo de las p velas ANTERIORES, para detectar rupturas).
  function donchian(h, l, p) {
    p = p || 20;
    const n = h.length;
    const upper = blank(n);
    const lower = blank(n);
    for (let i = p; i < n; i++) {
      upper[i] = highest(h, p, i - 1);
      lower[i] = lowest(l, p, i - 1);
    }
    return { upper, lower };
  }

  /* ---------- Tendencia ---------- */
  function adx(h, l, c, p) {
    p = p || 14;
    const n = c.length;
    const pdm = blank(n);
    const mdm = blank(n);
    const tr = blank(n);
    for (let i = 1; i < n; i++) {
      const up = h[i] - h[i - 1];
      const dn = l[i - 1] - l[i];
      pdm[i] = up > dn && up > 0 ? up : 0;
      mdm[i] = dn > up && dn > 0 ? dn : 0;
      tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    }
    const sp = rma(pdm, p);
    const sm = rma(mdm, p);
    const st = rma(tr, p);
    const pdi = blank(n);
    const mdi = blank(n);
    const dx = blank(n);
    for (let i = 0; i < n; i++) {
      if (!(st[i] > 0)) continue;
      pdi[i] = (100 * sp[i]) / st[i];
      mdi[i] = (100 * sm[i]) / st[i];
      const s = pdi[i] + mdi[i];
      dx[i] = s ? (100 * Math.abs(pdi[i] - mdi[i])) / s : 0;
    }
    return { adx: rma(dx, p), pdi, mdi };
  }

  // Supertrend (ATR p, multiplicador m): dir = 1 alcista, -1 bajista.
  function supertrend(h, l, c, p, m) {
    p = p || 10;
    m = m || 3;
    const n = c.length;
    const a = atr(h, l, c, p);
    const line = blank(n);
    const dir = blank(n);
    let up = NaN;
    let dn = NaN;
    let d = 1;
    for (let i = 0; i < n; i++) {
      if (!ok(a[i])) continue;
      const hl2 = (h[i] + l[i]) / 2;
      const bu = hl2 + m * a[i];
      const bl = hl2 - m * a[i];
      const pc = c[i - 1];
      const pu = up;
      const pd = dn;
      up = ok(up) && !(bu < up || pc > up) ? up : bu;
      dn = ok(dn) && !(bl > dn || pc < dn) ? dn : bl;
      // El cambio de dirección se decide con las bandas de la vela anterior.
      if (ok(line[i - 1])) {
        if (d === 1 && c[i] < pd) d = -1;
        else if (d === -1 && c[i] > pu) d = 1;
      }
      dir[i] = d;
      line[i] = d === 1 ? dn : up;
    }
    return { line, dir };
  }

  /* Ichimoku Kinko Hyo (9, 26, 52). senkouA/B[i] es el valor de la nube
   * DIBUJADA en la vela i (calculada con datos de i-26). cloudAhead contiene
   * las 26 velas de nube que se proyectan hacia el futuro desde la última. */
  function ichimoku(h, l, c, t, k, s) {
    t = t || 9;
    k = k || 26;
    s = s || 52;
    const n = c.length;
    const mid = (p, i) => (i >= p - 1 ? (highest(h, p, i) + lowest(l, p, i)) / 2 : NaN);
    const tenkan = blank(n);
    const kijun = blank(n);
    const rawA = blank(n);
    const rawB = blank(n);
    for (let i = 0; i < n; i++) {
      tenkan[i] = mid(t, i);
      kijun[i] = mid(k, i);
      rawA[i] = (tenkan[i] + kijun[i]) / 2;
      rawB[i] = mid(s, i);
    }
    const senkouA = blank(n);
    const senkouB = blank(n);
    for (let i = k; i < n; i++) {
      senkouA[i] = rawA[i - k];
      senkouB[i] = rawB[i - k];
    }
    const ahead = [];
    for (let j = 1; j <= k; j++) {
      const src = n - 1 - k + j;
      ahead.push({ a: rawA[src], b: rawB[src] });
    }
    return { tenkan, kijun, senkouA, senkouB, ahead, shift: k };
  }

  // Regresión lineal móvil del logaritmo del precio: pendiente, t de Student y R².
  function linreg(close, p) {
    p = p || 50;
    const n = close.length;
    const slope = blank(n);
    const tstat = blank(n);
    const r2 = blank(n);
    const xm = (p - 1) / 2;
    let sxx = 0;
    for (let x = 0; x < p; x++) sxx += (x - xm) ** 2;
    for (let i = p - 1; i < n; i++) {
      let ym = 0;
      for (let x = 0; x < p; x++) ym += Math.log(close[i - p + 1 + x]);
      ym /= p;
      let sxy = 0;
      let syy = 0;
      for (let x = 0; x < p; x++) {
        const y = Math.log(close[i - p + 1 + x]) - ym;
        sxy += (x - xm) * y;
        syy += y * y;
      }
      const b = sxy / sxx;
      const sse = Math.max(0, syy - b * sxy);
      const se = Math.sqrt(sse / (p - 2) / sxx);
      slope[i] = b;
      tstat[i] = se > 0 ? b / se : 0;
      r2[i] = syy > 0 ? (b * sxy) / syy : 0;
    }
    return { slope, tstat, r2 };
  }

  /* ---------- Volumen ---------- */
  function obv(c, v) {
    const out = new Array(c.length).fill(0);
    for (let i = 1; i < c.length; i++) out[i] = out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0);
    return out;
  }

  // Money Flow Index: RSI ponderado por volumen.
  function mfi(h, l, c, v, p) {
    p = p || 14;
    const n = c.length;
    const tp = c.map((x, i) => (h[i] + l[i] + x) / 3);
    const out = blank(n);
    for (let i = p; i < n; i++) {
      let pos = 0;
      let neg = 0;
      for (let k = i - p + 1; k <= i; k++) {
        const f = tp[k] * v[k];
        if (tp[k] > tp[k - 1]) pos += f;
        else if (tp[k] < tp[k - 1]) neg += f;
      }
      out[i] = neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
    }
    return out;
  }

  // Chaikin Money Flow: presión compradora/vendedora dentro de cada vela.
  function cmf(h, l, c, v, p) {
    p = p || 20;
    const n = c.length;
    const mfv = c.map((x, i) => (h[i] === l[i] ? 0 : ((x - l[i] - (h[i] - x)) / (h[i] - l[i])) * v[i]));
    const out = blank(n);
    for (let i = p - 1; i < n; i++) {
      let a = 0;
      let b = 0;
      for (let k = i - p + 1; k <= i; k++) {
        a += mfv[k];
        b += v[k];
      }
      out[i] = b ? a / b : 0;
    }
    return out;
  }

  // VWAP anclado al día UTC (o a la semana si las velas son diarias o mayores).
  function vwap(t, h, l, c, v, stepMs) {
    const n = c.length;
    const out = blank(n);
    const anchor = stepMs >= 86400e3 ? 7 * 86400e3 : 86400e3;
    let key = null;
    let pv = 0;
    let vv = 0;
    for (let i = 0; i < n; i++) {
      const kk = Math.floor((t[i] + (anchor > 86400e3 ? 3 * 86400e3 : 0)) / anchor); // semanas desde lunes
      if (kk !== key) {
        key = kk;
        pv = 0;
        vv = 0;
      }
      const tp = (h[i] + l[i] + c[i]) / 3;
      pv += tp * v[i];
      vv += v[i];
      out[i] = vv ? pv / vv : tp;
    }
    return out;
  }

  FX.ind = {
    sma, ema, rma, highest, lowest, rsi, macd, stochastic, cci, trueRange, atr, bollinger, keltner, donchian,
    adx, supertrend, ichimoku, linreg, obv, mfi, cmf, vwap,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
