/* Estadística y álgebra lineal básicas, lectura de CSV.
 * Scripts clásicos sin bundler: cada archivo añade su parte a globalThis.PF,
 * así la app abre directamente desde index.html y las pruebas corren en Node. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});

  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => sum(a) / a.length;
  const dot = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  };
  const matVec = (M, v) => M.map((row) => dot(row, v));
  const quad = (M, v) => dot(v, matVec(M, v));

  function covariance(x, y) {
    const mx = mean(x);
    const my = mean(y);
    let s = 0;
    for (let i = 0; i < x.length; i++) s += (x[i] - mx) * (y[i] - my);
    return s / (x.length - 1);
  }
  const variance = (x) => covariance(x, x);

  function covMatrix(series) {
    const n = series.length;
    const C = [];
    for (let i = 0; i < n; i++) {
      C.push(new Array(n));
      for (let j = 0; j <= i; j++) {
        const c = covariance(series[i], series[j]);
        C[i][j] = c;
        if (j < i) C[j][i] = c;
      }
    }
    return C;
  }

  function corrFromCov(C) {
    return C.map((row, i) => row.map((c, j) => c / Math.sqrt(C[i][i] * C[j][j])));
  }

  /* Resuelve A x = b por eliminación gaussiana con pivoteo parcial. */
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.slice().concat([b[i]]));
    for (let k = 0; k < n; k++) {
      let p = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
      if (Math.abs(M[p][k]) < 1e-300) throw new Error('sistema singular');
      [M[k], M[p]] = [M[p], M[k]];
      for (let i = k + 1; i < n; i++) {
        const f = M[i][k] / M[k][k];
        if (f === 0) continue;
        for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  /* Regresión simple y = a + b x (modelo de mercado). Devuelve alfa con su
   * error típico y estadístico t, beta, R² y varianza residual. */
  function regress(y, x) {
    const T = y.length;
    const mx = mean(x);
    const my = mean(y);
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < T; i++) {
      sxx += (x[i] - mx) ** 2;
      sxy += (x[i] - mx) * (y[i] - my);
    }
    const beta = sxx > 0 ? sxy / sxx : 0;
    const alpha = my - beta * mx;
    let sse = 0;
    let sst = 0;
    for (let i = 0; i < T; i++) {
      sse += (y[i] - alpha - beta * x[i]) ** 2;
      sst += (y[i] - my) ** 2;
    }
    const residVar = T > 2 ? sse / (T - 2) : 0;
    const seAlpha = Math.sqrt(residVar * (1 / T + (mx * mx) / (sxx || 1)));
    const seBeta = Math.sqrt(residVar / (sxx || 1));
    return {
      alpha,
      beta,
      r2: sst > 0 ? 1 - sse / sst : 0,
      residVar,
      seAlpha,
      tAlpha: seAlpha > 0 ? alpha / seAlpha : 0,
      seBeta,
    };
  }

  /* Valor p bilateral aproximado de un estadístico t (normal para gl ≥ 30,
   * corrección de Cornish-Fisher de primer orden por debajo). */
  function pValue(t, df) {
    const z = df > 0 ? Math.abs(t) * (1 - 1 / (4 * df)) / Math.sqrt(1 + (t * t) / (2 * df)) : Math.abs(t);
    return 2 * (1 - normalCdf(z));
  }

  function normalCdf(z) {
    // Abramowitz y Stegun 7.1.26
    const s = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + s * y);
  }

  /* ---------- CSV ---------- */

  function splitLine(line, sep) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === sep && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  function detectSep(line) {
    const counts = [['\t', 0], [';', 0], [',', 0]].map(([s]) => [s, splitLine(line, s).length]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 1 ? counts[0][0] : ',';
  }

  /* Convierte "1.234,56", "1,234.56", "12,5 %", "$ 300" en número. */
  function parseNumber(s, decimalComma) {
    if (s == null) return NaN;
    let t = String(s).replace(/[\s$€% ]/g, '');
    if (t === '' || t === '-' || /^(na|n\/a|null|nan)$/i.test(t)) return NaN;
    if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  }

  function parseCSV(text) {
    const lines = String(text)
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '');
    if (lines.length < 2) throw new Error('El archivo necesita una fila de encabezados y al menos una fila de datos.');
    const sep = detectSep(lines[0]);
    const headers = splitLine(lines[0], sep);
    const raw = lines.slice(1).map((l) => splitLine(l, sep));
    // Coma decimal: separador distinto de coma y celdas del tipo 12,34
    const sample = raw.slice(0, 20).flat();
    const decimalComma = sep !== ',' && sample.some((c) => /^-?[\d.]*\d,\d+%?$/.test(c.replace(/\s/g, '')));
    // Columna de fechas: la primera, si su contenido no es numérico
    const firstNumeric = raw.slice(0, 10).every((r) => Number.isFinite(parseNumber(r[0], decimalComma)));
    const dateCol = firstNumeric ? -1 : 0;
    const cols = headers.map((h, i) => i).filter((i) => i !== dateCol);
    const names = cols.map((i) => headers[i] || 'Columna ' + (i + 1));
    const dates = [];
    const values = cols.map(() => []);
    let dropped = 0;
    for (const r of raw) {
      const v = cols.map((i) => parseNumber(r[i], decimalComma));
      if (v.some((x) => !Number.isFinite(x))) {
        dropped++;
        continue;
      }
      dates.push(dateCol >= 0 ? r[dateCol] : String(dates.length + 1));
      v.forEach((x, k) => values[k].push(x));
    }
    return { names, dates, values, dropped, sep, decimalComma };
  }

  /* Rendimientos simples por periodo a partir de precios, o validación de
   * rendimientos ya calculados (en decimales o en %). */
  function toReturns(values, kind) {
    if (kind === 'prices') {
      return values.map((p) => {
        if (p.some((x) => x <= 0)) throw new Error('Hay precios menores o iguales a cero; revisa los datos o elige «Rendimientos».');
        const r = [];
        for (let t = 1; t < p.length; t++) r.push(p[t] / p[t - 1] - 1);
        return r;
      });
    }
    // Si alguna columna tiene valores absolutos mayores que 1,5 se asume que están en %.
    const pct = values.some((c) => c.some((x) => Math.abs(x) > 1.5));
    return values.map((c) => (pct ? c.map((x) => x / 100) : c.slice()));
  }

  const MARKET_RE = /(mercado|market|[íi]ndice|index|benchmark|ipc|s&p|sp ?500|spx|ibex|merval|bovespa|ibov|ipsa|colcap|msci|nasdaq|dow|acwi|^spy$)/i;
  function guessMarket(names) {
    const i = names.findIndex((n) => MARKET_RE.test(n));
    return i >= 0 ? i : names.length - 1;
  }

  Object.assign(PF, {
    stats: { sum, mean, dot, matVec, quad, covariance, variance, covMatrix, corrFromCov, solve, regress, pValue, normalCdf },
    data: { parseCSV, parseNumber, toReturns, guessMarket },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
