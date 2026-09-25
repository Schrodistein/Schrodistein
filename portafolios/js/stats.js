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

  /* ---------- Historiales por activo (BVC, Investing.com, Yahoo Finance) ---------- */

  /* Encabezados: se comparan sin tildes, mayúsculas ni signos, y por contenido
   * («Precio de cierre ($)», «FECHA OPERACIÓN», «Último precio» también valen). */
  const norm = (h) =>
    String(h == null ? '' : h)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9% ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const isDateHdr = (h) => /(^| )(fecha|date|time|dia|periodo)( |$)/.test(norm(h));
  const NOT_PRICE = /(%|variacion|var |cambio|change|volumen|volume|vol$|cantidad|monto|apertura|open|maximo|max|high|minimo|min|low|anterior|previo|prev|promedio|avg|numero|nro)/;
  const PRICE_LEVELS = [
    /(cierre ajustado|adj close|adjusted close|precio ajustado)/,
    /(precio de cierre|precio cierre|cierre|close|ultimo|last)/,
    /^(precio|price|valor)( |$)/,
  ];
  const isTickerHdr = (h) => /(nemotecnico|nemo|ticker|simbolo|symbol|especie|instrumento|emisor|accion)/.test(norm(h));
  const clean = (h) => String(h == null ? '' : h).replace(/^"|"$/g, '').replace(/\s+/g, ' ').trim();

  function priceColumn(h, skip) {
    for (const re of PRICE_LEVELS) {
      const i = h.findIndex((x, k) => !skip.includes(k) && re.test(norm(x)) && !NOT_PRICE.test(norm(x)) && !isDateHdr(x) && !isTickerHdr(x));
      if (i >= 0) return i;
    }
    return -1;
  }

  /* Busca la fila de encabezados (puede haber títulos encima, como en los Excel de la BVC). */
  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const h = (rows[r] || []).map(clean);
      const di = h.findIndex(isDateHdr);
      if (di < 0) continue;
      const ti = h.findIndex((x, k) => k !== di && isTickerHdr(x));
      const pi = priceColumn(h, [di, ti]);
      if (pi >= 0) return { row: r, di, pi, ti, head: h };
    }
    return null;
  }

  /* Primeras filas con contenido, para explicar un archivo que no se reconoce. */
  function describeRows(rows) {
    const first = rows.find((r) => r && r.filter((c) => clean(c) !== '').length >= 2);
    return first ? first.map(clean).filter(Boolean).slice(0, 8).join(' | ') : '';
  }

  function csvRows(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
    if (!lines.length) return [];
    const sep = detectSep(lines.find((l) => splitLine(l, detectSep(l)).some(isDateHdr)) || lines[0]);
    return lines.map((l) => splitLine(l, sep));
  }

  /* ¿El texto es un historial por activo (columna de fecha + columna de precio)? */
  function isSingleAsset(text) {
    return !!findHeader(csvRows(text).slice(0, 30));
  }

  /* Decide si una columna usa coma decimal ("1.234,56") o punto ("1,234.56"). */
  function columnDecimalComma(cells, sep) {
    let comma = 0;
    let dot = 0;
    for (const c0 of cells) {
      const c = c0.replace(/[\s$%]/g, '');
      const lc = c.lastIndexOf(',');
      const ld = c.lastIndexOf('.');
      if (lc >= 0 && ld >= 0) (lc > ld ? comma++ : dot++);
      else if (lc >= 0) (/,\d{3}$/.test(c) && sep === ',' ? dot++ : comma++);
      else if (ld >= 0) (/\.\d{3}$/.test(c) ? comma++ : dot++);
    }
    return comma > dot;
  }

  /* Fechas: 2024-01-31, 31.01.2024, 31/01/2024, 01/31/2024, "Jan 31, 2024". */
  const MONTHS = { jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12 };
  function parseDates(cells, preferDayFirst) {
    const parts = cells.map((c) => {
      const t = c.trim();
      let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (m) return { y: +m[1], a: +m[2], b: +m[3], iso: true };
      m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
      if (m) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], a: +m[1], b: +m[2] };
      m = t.match(/^([A-Za-zé]{3})[a-zé]*\.? (\d{1,2}),? (\d{4})/);
      if (m && MONTHS[m[1].toLowerCase()]) return { y: +m[3], a: MONTHS[m[1].toLowerCase()], b: +m[2], iso: true };
      m = t.match(/^(\d{1,2}) ([A-Za-zé]{3})[a-zé]*\.? (\d{4})/);
      if (m && MONTHS[m[2].toLowerCase()]) return { y: +m[3], a: MONTHS[m[2].toLowerCase()], b: +m[1], iso: true };
      return null;
    });
    const plain = parts.filter((p) => p && !p.iso);
    let dayFirst = preferDayFirst;
    if (plain.some((p) => p.a > 12)) dayFirst = true;
    else if (plain.some((p) => p.b > 12)) dayFirst = false;
    return parts.map((p) => {
      if (!p) return null;
      const [mo, d] = p.iso ? [p.a, p.b] : dayFirst ? [p.b, p.a] : [p.a, p.b];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return p.y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    });
  }

  function nameFromFile(fileName) {
    return String(fileName || 'Activo')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/\s*(\(\d+\))$/, '')
      .replace(/\s*[-_]?\s*(historical data|datos hist[óo]ricos|hist[óo]rico|history)$/i, '')
      .replace(/\.(CL|BVC)$/i, '')
      .replace(/[_]+/g, ' ')
      .trim() || 'Activo';
  }

  /* Fecha de una celda de Excel: objeto Date o número de serie (días desde 1899-12-30). */
  function cellDate(v) {
    if (v instanceof Date && !isNaN(v)) {
      // SheetJS crea la fecha en hora local; se redondea al día más cercano.
      const t = new Date(v.getTime() + 12 * 36e5);
      return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    }
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
    return null;
  }

  /* Filas (texto, números o fechas) → historiales. Si hay columna de nemotécnico
   * con varios valores, devuelve un historial por nemotécnico. */
  function seriesFromRows(rows, fileName) {
    const hd = findHeader(rows);
    if (!hd) {
      const seen = describeRows(rows);
      throw new Error(`En «${fileName}» no se encontró una columna de fecha y otra de precio de cierre.${seen ? ` Encabezados leídos: ${seen}.` : ' El archivo parece vacío.'}`);
    }
    const body = rows.slice(hd.row + 1).filter((r) => r && r.some((c) => clean(c) !== ''));
    const strCells = body.map((r) => (typeof r[hd.pi] === 'number' ? '' : clean(r[hd.pi])));
    const dc = columnDecimalComma(strCells.filter(Boolean), ',');
    const spanish = hd.head.some((h) => /fecha|cierre|ultimo|apertura|precio/.test(norm(h)));
    const strDates = parseDates(body.map((r) => (cellDate(r[hd.di]) || clean(r[hd.di]))), spanish);
    const groups = new Map();
    body.forEach((r, k) => {
      const raw = r[hd.pi];
      const v = typeof raw === 'number' ? raw : parseNumber(clean(raw), dc);
      const d = strDates[k];
      if (!d || !Number.isFinite(v) || v <= 0) return;
      const key = hd.ti >= 0 && clean(r[hd.ti]) ? clean(r[hd.ti]).toUpperCase() : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([d, v]);
    });
    const out = [];
    for (const [key, pts] of groups) {
      const s = finishSeries(pts, key || nameFromFile(fileName), hd.head[hd.pi]);
      if (s) out.push(s);
    }
    if (!out.length) throw new Error(`No se reconocieron fechas y precios en «${fileName}».`);
    return out;
  }

  function finishSeries(pts, name, column) {
    if (pts.length < 2) return null;
    pts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const dedup = pts.filter((p, i) => i === pts.length - 1 || p[0] !== pts[i + 1][0]);
    return { name, dates: dedup.map((p) => p[0]), prices: dedup.map((p) => p[1]), column };
  }

  /* Historial de un activo desde texto CSV (compatibilidad: devuelve el primero). */
  function parseSeriesFile(text, fileName) {
    return seriesFromRows(csvRows(text), fileName)[0];
  }
  function parseSeriesText(text, fileName) {
    return seriesFromRows(csvRows(text), fileName);
  }

  /* Junta los tramos del mismo activo (la BVC descarga como máximo 6 meses por archivo). */
  function combineSeries(list) {
    const by = new Map();
    for (const s of list) {
      const k = s.name.toUpperCase();
      if (!by.has(k)) by.set(k, { name: s.name, column: s.column, pts: [], parts: 0 });
      const g = by.get(k);
      g.parts++;
      s.dates.forEach((d, i) => g.pts.push([d, s.prices[i]]));
    }
    return [...by.values()].map((g) => Object.assign(finishSeries(g.pts, g.name, g.column), { parts: g.parts }));
  }

  /* Clave de periodo para agrupar precios diarios en la frecuencia elegida. */
  function periodKey(iso, freq) {
    const [y, m, d] = iso.split('-').map(Number);
    if (freq === 'anual') return String(y);
    if (freq === 'trimestral') return y + '-T' + Math.ceil(m / 3);
    if (freq === 'mensual') return iso.slice(0, 7);
    if (freq === 'semanal') {
      const t = Date.UTC(y, m - 1, d);
      const dow = (new Date(t).getUTCDay() + 6) % 7; // lunes = 0
      return new Date(t - dow * 864e5).toISOString().slice(0, 10);
    }
    return iso;
  }

  /* Une varios historiales: último precio de cada periodo y solo los periodos
   * que tienen todos los activos. Devuelve el mismo formato que parseCSV. */
  function mergeSeries(list, freq) {
    if (list.length < 2) throw new Error('Sube al menos dos archivos: tus acciones y el índice de mercado.');
    const used = {};
    const names = list.map((s) => {
      let n = s.name;
      used[n] = (used[n] || 0) + 1;
      return used[n] > 1 ? n + ' (' + used[n] + ')' : n;
    });
    const maps = list.map((s) => {
      const m = new Map();
      s.dates.forEach((d, i) => m.set(periodKey(d, freq), [d, s.prices[i]]));
      return m;
    });
    let keys = [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k)));
    keys.sort();
    // El último periodo puede estar incompleto (mes en curso): se conserva, es el dato más reciente.
    if (keys.length < 3) throw new Error('Los archivos casi no tienen periodos en común. Revisa que cubran las mismas fechas.');
    const dates = keys.map((k) => maps.reduce((a, m) => (m.get(k)[0] > a ? m.get(k)[0] : a), ''));
    const values = maps.map((m) => keys.map((k) => m.get(k)[1]));
    const lost = list.map((s, i) => maps[i].size - keys.length);
    return { names, dates, values, dropped: 0, lost, sep: ',', decimalComma: false };
  }

  /* De vuelta a CSV (para mostrar y guardar el resultado de la unión). */
  function toCSV(p) {
    const q = (s) => (/[",;\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s);
    const rows = [['Fecha'].concat(p.names).map(q).join(',')];
    p.dates.forEach((d, t) => rows.push([d].concat(p.values.map((c) => +c[t].toPrecision(10))).join(',')));
    return rows.join('\n');
  }


  const MARKET_RE = /(mercado|market|[íi]ndice|index|benchmark|colcap|coleqty|ipc|s&p|sp ?500|spx|ibex|merval|bovespa|ibov|ipsa|colcap|msci|nasdaq|dow|acwi|^spy$)/i;
  function guessMarket(names) {
    const i = names.findIndex((n) => MARKET_RE.test(n));
    return i >= 0 ? i : names.length - 1;
  }

  Object.assign(PF, {
    stats: { sum, mean, dot, matVec, quad, covariance, variance, covMatrix, corrFromCov, solve, regress, pValue, normalCdf },
    data: { parseCSV, parseNumber, toReturns, guessMarket, isSingleAsset, parseSeriesFile, parseSeriesText, seriesFromRows, combineSeries, mergeSeries, toCSV, periodKey },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
