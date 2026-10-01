/* Radar de Divisas — espacio de nombres FX y utilidades compartidas.
 * Scripts clásicos sin dependencias: funcionan en el navegador (también
 * abriendo index.html sin servidor) y en Node, para las pruebas y para el
 * escáner de consola. Cada archivo añade su parte a globalThis.FX. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});

  // PRNG reproducible (mulberry32) con normal estándar (Box-Muller).
  function rng(seed) {
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.normal = () => {
      let u = 0;
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    };
    return next;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  // Duración de cada temporalidad de Binance en milisegundos.
  const INTERVALS = {
    '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3,
    '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '6h': 21600e3, '8h': 28800e3, '12h': 43200e3,
    '1d': 86400e3, '3d': 259200e3, '1w': 604800e3,
  };

  // Decimales que usa un par según su tickSize ("0.00010000" → 4).
  function decimalsFromTick(tick) {
    if (tick == null) return null;
    const s = String(tick);
    if (/e/i.test(s)) return Math.max(0, Math.round(-Math.log10(Number(s))));
    if (s.indexOf('.') < 0) return 0;
    return s.split('.')[1].replace(/0+$/, '').length;
  }

  // Decimales razonables cuando no se conoce el tickSize.
  function autoDecimals(price) {
    const p = Math.abs(price);
    if (!(p > 0)) return 2;
    if (p >= 1000) return 2;
    if (p >= 10) return 3;
    if (p >= 1) return 4;
    if (p >= 0.01) return 6;
    return 8;
  }

  function fmtPrice(x, d) {
    if (!Number.isFinite(x)) return '—';
    return x.toFixed(d == null ? autoDecimals(x) : d);
  }

  // Velas [{t,o,h,l,c,v}] → series por columnas, más cómodas para los indicadores.
  function toSeries(candles) {
    const n = candles.length;
    const S = { n, t: new Array(n), o: new Array(n), h: new Array(n), l: new Array(n), c: new Array(n), v: new Array(n) };
    for (let i = 0; i < n; i++) {
      const k = candles[i];
      S.t[i] = k.t;
      S.o[i] = k.o;
      S.h[i] = k.h;
      S.l[i] = k.l;
      S.c[i] = k.c;
      S.v[i] = k.v;
    }
    return S;
  }

  // Índice de la última vela cerrada (Binance devuelve también la vela en curso).
  function lastClosed(candles) {
    const n = candles.length;
    if (!n) return -1;
    return candles[n - 1].closed === false ? n - 2 : n - 1;
  }

  /* Mercado sintético para pruebas y para el modo demostración: paseo
   * aleatorio con cambios de régimen (tendencia/rango) y volatilidad
   * estocástica. No tiene ventaja explotable: sirve para probar el código,
   * no para validar estrategias. */
  function synthetic(n, opts) {
    opts = opts || {};
    const R = rng(opts.seed == null ? 7 : opts.seed);
    const step = opts.intervalMs || 3600e3;
    const end = opts.end == null ? Date.UTC(2026, 0, 1) : Math.floor(opts.end / step) * step;
    const t0 = end - n * step;
    const base = opts.vol || 0.002;
    let price = opts.start || 1.08;
    let drift = 0;
    let vol = base;
    const out = [];
    for (let k = 0; k < n; k++) {
      if (R() < 0.03) drift = (R() - 0.5) * base * 0.8;
      vol = clamp(vol + 0.05 * (base - vol) + vol * 0.12 * R.normal(), base * 0.4, base * 3);
      const o = price;
      let p = o;
      let hi = o;
      let lo = o;
      for (let s = 0; s < 4; s++) {
        p *= Math.exp(drift / 4 + (vol / 2) * R.normal());
        hi = Math.max(hi, p);
        lo = Math.min(lo, p);
      }
      hi *= 1 + Math.abs(R.normal()) * vol * 0.3;
      lo *= 1 - Math.abs(R.normal()) * vol * 0.3;
      const v = (800 + R() * 600) * (1 + Math.abs(p - o) / o / vol);
      out.push({ t: t0 + k * step, o, h: hi, l: lo, c: p, v, T: t0 + (k + 1) * step - 1, closed: true });
      price = p;
    }
    return out;
  }

  FX.util = { rng, clamp, INTERVALS, decimalsFromTick, autoDecimals, fmtPrice, toSeries, lastClosed, synthetic };
})(typeof globalThis !== 'undefined' ? globalThis : this);
