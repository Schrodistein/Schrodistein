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

  /* Valores y vectores propios de una matriz simétrica (método de Jacobi). */
  function eigSym(A0) {
    const n = A0.length;
    const A = A0.map((r) => r.slice());
    const V = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-300) continue;
          const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
          const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
          const c = 1 / Math.sqrt(t * t + 1);
          const sn = t * c;
          for (let k = 0; k < n; k++) {
            const akp = A[k][p];
            const akq = A[k][q];
            A[k][p] = c * akp - sn * akq;
            A[k][q] = sn * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = A[p][k];
            const aqk = A[q][k];
            A[p][k] = c * apk - sn * aqk;
            A[q][k] = sn * apk + c * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = V[k][p];
            const vkq = V[k][q];
            V[k][p] = c * vkp - sn * vkq;
            V[k][q] = sn * vkp + c * vkq;
          }
        }
      }
    }
    return { values: A.map((r, i) => r[i]), vectors: V };
  }

  /* Matriz de correlación válida (semidefinida positiva) más cercana: se recortan
   * los valores propios negativos que aparecen al estimar cada par con fechas distintas. */
  function nearestCorr(R) {
    const n = R.length;
    const { values, vectors } = eigSym(R);
    if (Math.min(...values) > 1e-10) return { R, fixed: false };
    const lam = values.map((v) => Math.max(v, 1e-8));
    const B = R.map((_, i) => R.map((__, j) => vectors[i].reduce((s, v, k) => s + v * lam[k] * vectors[j][k], 0)));
    const d = B.map((r, i) => Math.sqrt(r[i]));
    return { R: B.map((r, i) => r.map((x, j) => (i === j ? 1 : x / (d[i] * d[j])))), fixed: true };
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
    // Se conservan las filas con huecos (activos que no cotizaron ese día, historias
    // de distinta longitud); el modelo decide cómo usarlas. Se descartan las vacías.
    for (const r of raw) {
      const v = cols.map((i) => parseNumber(r[i], decimalComma));
      if (v.filter((x) => Number.isFinite(x)).length < Math.min(2, cols.length)) {
        dropped++;
        continue;
      }
      dates.push(dateCol >= 0 ? r[dateCol] : String(dates.length + 1));
      v.forEach((x, k) => values[k].push(x));
    }
    return { names, dates, values, dropped, sep, decimalComma };
  }

  /* Rendimientos por periodo a partir de precios (simples o logarítmicos, ln(Pt/Pt−1)),
   * o validación de rendimientos ya calculados (en decimales o en %). Un hueco en los
   * precios deja NaN en los dos rendimientos que lo tocan. */
  function toReturns(values, kind, logRet) {
    if (kind === 'prices') {
      return values.map((p) => {
        if (p.some((x) => x <= 0)) throw new Error('Hay precios menores o iguales a cero; revisa los datos o elige «Rendimientos».');
        const r = [];
        for (let t = 1; t < p.length; t++) {
          const ok = Number.isFinite(p[t]) && Number.isFinite(p[t - 1]);
          r.push(ok ? (logRet ? Math.log(p[t] / p[t - 1]) : p[t] / p[t - 1] - 1) : NaN);
        }
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
    /(precio de liquidacion|precio liquidacion|liquidacion|settle|precio de valoracion|precio valoracion|precio de mercado|precio sucio|precio limpio)/,
    /^(precio|price|valor)( |$)/,
  ];
  // Divisas: «TRM», «Tasa de cambio» son precios aunque digan «tasa» o «cambio»
  const FX_PRICE = /(^| )(trm|tasa de cambio|tipo de cambio|tasa representativa)( |$)/;
  // Renta fija: tasa de negociación o de valoración (TES, bonos, CDT)
  const RATE_HDR = /(^| )(tasa|tir|yield|tasa efectiva|tasa de negociacion|tasa de valoracion|tasa cierre|tasa de cierre|rendimiento)( |$)/;
  const NOT_RATE = /(variacion|cambio|representativa|trm|anterior|previo|maxim|minim|apertura|promedio)/;
  const FI_PRICE = /(precio sucio|precio limpio|precio de valoracion|precio valoracion)/;
  const DUR_HDR = /(^| )(duracion|duration)( |$)/;
  const isTickerHdr = (h) => /(nemotecnico|nemo|ticker|simbolo|symbol|especie|instrumento|emisor|accion)/.test(norm(h));
  const clean = (h) => String(h == null ? '' : h).replace(/^"|"$/g, '').replace(/\s+/g, ' ').trim();

  function priceColumn(h, skip) {
    const fx = h.findIndex((x, k) => !skip.includes(k) && FX_PRICE.test(norm(x)) && !/variacion/.test(norm(x)));
    if (fx >= 0) return fx;
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
      const ri = h.findIndex((x, k) => k !== di && k !== ti && RATE_HDR.test(norm(x)) && !NOT_RATE.test(norm(x)));
      const ui = h.findIndex((x) => DUR_HDR.test(norm(x)));
      // Renta fija: con tasa y sin precio de cierre, o con precio limpio/sucio, se usa la tasa
      if (ri >= 0 && (pi < 0 || FI_PRICE.test(norm(h[pi])))) return { row: r, di, pi: ri, ti, head: h, rate: true, ui };
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
      const t = String(c).trim();
      let m = t.match(/^(\d{4})[-/.](\d{1,2})$/);
      if (m) return { y: +m[1], a: +m[2], b: 1, iso: true };
      m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
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
      .replace(/^[0-9a-f]{8}-/i, '') // prefijo de algunos gestores de descargas
      .replace(/[ _-]\d{8}([ _-]\d{4,6})?([ _-]\d+(\.\d+)?)?$/, '') // sufijo de la BVC: _20260915_2, _20260908_051610
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
    // Las tasas no llevan separador de miles: «10.500» es 10,5 %, y «10,5» también
    const dc = hd.rate ? strCells.some((c) => /,\d/.test(c) && !/\./.test(c)) : columnDecimalComma(strCells.filter(Boolean), ',');
    const spanish = hd.head.some((h) => /fecha|cierre|ultimo|apertura|precio/.test(norm(h)));
    const strDates = parseDates(body.map((r) => (cellDate(r[hd.di]) || clean(r[hd.di]))), spanish);
    // Días sin negociación: la BVC repite un precio de referencia con cantidad vacía.
    // Si el archivo trae cantidad o volumen y casi siempre tiene valor, esos días se omiten.
    const qi = hd.head.findIndex((h, i) => i !== hd.pi && /^(cantidad|volumen|volume|vol)( |$)/.test(norm(h)));
    const numAt = (r, k) => (typeof r[k] === 'number' ? r[k] : parseNumber(clean(r[k]), false));
    const qty = (r) => numAt(r, qi);
    const withQty = qi >= 0 ? body.filter((r) => qty(r) > 0).length : 0;
    const skipNoTrade = qi >= 0 && withQty >= 0.5 * body.length;
    // Cantidad de acciones y monto negociado de cada día (para medir la liquidez del COLEQTY)
    const ci = hd.head.findIndex((h, i) => i !== hd.pi && /^cantidad( |$)/.test(norm(h)));
    const mi = hd.head.findIndex((h, i) => i !== hd.pi && /^(volumen|monto|volume)( |$)/.test(norm(h)));
    let noTrade = 0;
    const groups = new Map();
    const durs = [];
    body.forEach((r, k) => {
      if (skipNoTrade && !(qty(r) > 0) && clean(r[hd.pi]) !== '') {
        noTrade++;
        return;
      }
      const raw = r[hd.pi];
      const v = typeof raw === 'number' ? raw : parseNumber(clean(raw), dc);
      const d = strDates[k];
      if (!d || !Number.isFinite(v) || (hd.rate ? v < -50 : v <= 0)) return;
      if (hd.rate && hd.ui >= 0) {
        const u = typeof r[hd.ui] === 'number' ? r[hd.ui] : parseNumber(clean(r[hd.ui]), dc);
        if (u > 0 && u < 60) durs.push(u);
      }
      const key = hd.ti >= 0 && clean(r[hd.ti]) ? clean(r[hd.ti]).toUpperCase() : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([d, v, 0, ci >= 0 ? numAt(r, ci) : NaN, mi >= 0 ? numAt(r, mi) : NaN]);
    });
    const out = [];
    for (const [key, pts] of groups) {
      const name = key || nameFromFile(fileName);
      if (hd.rate) {
        // Tasas en porcentaje (10,25) o en decimal (0,1025): se guardan en decimal
        const med = pts.map((p) => Math.abs(p[1])).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
        if (med > 1) pts.forEach((p) => (p[1] /= 100));
      }
      const s = finishSeries(pts, name, hd.head[hd.pi]);
      if (!s) continue;
      const cls = classify(name, hd.head);
      const extra = { noTrade, rank: 2, cls };
      if (hd.rate) Object.assign(extra, { kind: 'tasa', dur: durs.length ? durs.sort((a, b) => a - b)[Math.floor(durs.length / 2)] : DEFAULT_DUR[cls] || DEFAULT_DUR.bono });
      out.push(Object.assign(s, extra));
    }
    if (!out.length) throw new Error(`No se reconocieron fechas y precios en «${fileName}».`);
    return out;
  }

  /* Tabla ancha con columna de fecha: un activo por columna, con huecos permitidos
   * y encabezados en una o varias filas (p. ej. «PRECIO MAXIMO» encima de los
   * nemotécnicos). Se ignoran columnas de numeración como «ITEM». */
  const INDEX_HDR = /^(item|items|n|no|nro|numero|#|consecutivo|id|fila)$/;
  function wideSeriesFromRows(rows, fileName) {
    let hr = -1;
    let di = -1;
    for (let r = 0; r < Math.min(rows.length, 30) && hr < 0; r++) {
      const h = (rows[r] || []).map(clean);
      const k = h.findIndex(isDateHdr);
      if (k >= 0) {
        hr = r;
        di = k;
      }
    }
    if (hr < 0) return null;
    // Primera fila de datos: la primera con una fecha reconocible en la columna de fecha
    const isDateCell = (v) => !!(cellDate(v) || parseDates([clean(v)], true)[0]);
    let start = hr + 1;
    while (start < rows.length && start < hr + 6 && !isDateCell((rows[start] || [])[di])) start++;
    if (start >= rows.length || !isDateCell((rows[start] || [])[di])) return null;
    const body = [];
    for (let r = start; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!isDateCell(row[di])) continue; // filas de resumen debajo de los datos
      body.push(row);
    }
    if (body.length < 3) return null;
    const spanish = true;
    const strDates = parseDates(body.map((r) => cellDate(r[di]) || clean(r[di])), spanish);
    const width = Math.max(...rows.slice(hr, start).concat(body.slice(0, 50)).map((r) => (r || []).length));
    const out = [];
    let allVals = [];
    for (let c = 0; c < width; c++) {
      if (c === di) continue;
      let name = '';
      for (let r = hr; r < start; r++) {
        const t = clean((rows[r] || [])[c]);
        if (t && !Number.isFinite(parseNumber(t, false))) name = t;
      }
      if (!name || INDEX_HDR.test(norm(name))) continue;
      const cells = body.map((r) => r[c]);
      const strCells = cells.filter((v) => typeof v !== 'number').map(clean).filter(Boolean);
      const dc = columnDecimalComma(strCells, ',');
      const pts = [];
      cells.forEach((v, k) => {
        const x = typeof v === 'number' ? v : parseNumber(clean(v), dc);
        if (strDates[k] && Number.isFinite(x)) pts.push([strDates[k], x]);
      });
      if (pts.length < 3) continue;
      // Numeración 1, 2, 3… sin encabezado reconocible
      if (pts.every((p, k) => k === 0 || Math.abs(Math.abs(p[1] - pts[k - 1][1]) - 1) < 1e-9)) continue;
      allVals = allVals.concat(pts.map((p) => p[1]));
      const sr = finishSeries(pts, name, 'columna ' + name);
      if (sr) out.push(Object.assign(sr, { rank: 1 }));
    }
    if (!out.length) return null;
    const sorted = allVals.map(Math.abs).sort((a, b) => a - b);
    const returnsLike = allVals.some((v) => v < 0) || sorted[Math.floor(sorted.length / 2)] < 1.5;
    return { series: out, returnsLike };
  }

  /* Lee una hoja o un CSV en cualquier formato reconocido:
   * formato largo (fecha + precio de cierre, con o sin nemotécnico) o tabla ancha. */
  function readRows(rows, fileName) {
    if (findHeader(rows)) return { series: seriesFromRows(rows, fileName), layout: 'largo', returnsLike: false };
    const w = wideSeriesFromRows(rows, fileName);
    if (w) return { series: w.series, layout: 'ancho', returnsLike: w.returnsLike };
    const seen = describeRows(rows);
    throw new Error(`En «${fileName}» no se encontró una columna de fecha con precios.${seen ? ` Encabezados leídos: ${seen}.` : ' El archivo parece vacío.'}`);
  }
  function readText(text, fileName) {
    return readRows(csvRows(text), fileName);
  }
  /* ¿El texto tiene una columna de fecha reconocible (formato largo o ancho)? */
  function hasDates(text) {
    try {
      readText(text, 'texto');
      return true;
    } catch (e) {
      return false;
    }
  }

  function finishSeries(pts, name, column) {
    if (pts.length < 2) return null;
    // Misma fecha repetida: gana la fuente más confiable (rango mayor), luego la última leída
    pts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[2] || 0) - (b[2] || 0)));
    const dedup = pts.filter((p, i) => i === pts.length - 1 || p[0] !== pts[i + 1][0]);
    const out = { name, dates: dedup.map((p) => p[0]), prices: dedup.map((p) => p[1]), column };
    if (dedup.some((p) => Number.isFinite(p[3]) || Number.isFinite(p[4]))) {
      out.qty = dedup.map((p) => (Number.isFinite(p[3]) ? p[3] : NaN));
      out.vol = dedup.map((p) => (Number.isFinite(p[4]) ? p[4] : NaN));
    }
    return out;
  }

  /* Historial de un activo desde texto CSV (compatibilidad: devuelve el primero). */
  function parseSeriesFile(text, fileName) {
    return seriesFromRows(csvRows(text), fileName)[0];
  }
  function parseSeriesText(text, fileName) {
    return seriesFromRows(csvRows(text), fileName);
  }

  /* Junta los tramos del mismo activo (la BVC descarga como máximo 6 meses por archivo).
   * Las series de tasa (renta fija) se convierten, ya unidas, en un índice de rendimiento total. */
  /* Clave de un activo: el mismo nemotécnico aunque cambien mayúsculas, tildes, espacios o
   * guiones bajos entre los archivos (la BVC entrega cada historial en tramos de 6 meses). */
  const assetKey = (name) =>
    String(name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[\s_]+/g, ' ')
      .trim();

  function combineSeries(list) {
    const by = new Map();
    for (const s of list) {
      const k = assetKey(s.name);
      if (!by.has(k)) by.set(k, { name: s.name, column: s.column, pts: [], parts: 0, noTrade: 0, cls: s.cls, kind: s.kind, dur: s.dur });
      const g = by.get(k);
      g.parts++;
      g.noTrade += s.noTrade || 0;
      if (!g.cls && s.cls) g.cls = s.cls;
      if (s.kind === 'tasa') {
        g.kind = 'tasa';
        g.dur = g.dur || s.dur;
      }
      s.dates.forEach((d, i) => g.pts.push([d, s.prices[i], s.rank || 0, s.qty ? s.qty[i] : NaN, s.vol ? s.vol[i] : NaN]));
    }
    return [...by.values()].map((g) => {
      const f = finishSeries(g.pts, g.name, g.column);
      const out = Object.assign(f, { parts: g.parts, noTrade: g.noTrade, cls: g.cls || classify(g.name) });
      if (g.kind !== 'tasa') return out;
      const dur = g.dur || DEFAULT_DUR[out.cls] || DEFAULT_DUR.bono;
      const rates = f.prices;
      return Object.assign(out, { prices: rateIndex(f.dates, rates, dur), rates, dur, kind: 'tasa', column: `${g.column}: índice de rendimiento total con duración ${String(+dur.toFixed(2)).replace('.', ',')}` });
    });
  }

  /* Índice de rendimiento total de una serie de tasas efectivas anuales y:
   *   Rₜ = [(1 + yₜ₋₁)^Δt − 1]  −  D / (1 + yₜ₋₁) · (yₜ − yₜ₋₁)
   * causación de la tasa del periodo anterior menos el efecto precio (duración modificada).
   * Δt en años (días / 365). Base 100. */
  function rateIndex(dates, rates, dur) {
    const out = [100];
    for (let t = 1; t < rates.length; t++) {
      const dt = (Date.parse(dates[t]) - Date.parse(dates[t - 1])) / (365 * 864e5);
      const y0 = rates[t - 1];
      const r = Math.pow(1 + y0, dt) - 1 - (dur / (1 + y0)) * (rates[t] - y0);
      out.push(out[t - 1] * (1 + r));
    }
    return out;
  }

  /* Tipo de instrumento, por el nombre y los encabezados del archivo. */
  const CLASSES = { accion: 'Acción', etf: 'ETF', tes: 'TES', bono: 'Bono', cdt: 'CDT', divisa: 'Divisa', futuro: 'Futuro', opcion: 'Opción', indice: 'Índice' };
  const DEFAULT_DUR = { cdt: 0.5, tes: 6, bono: 4 };
  function classify(name, head) {
    const n = norm(name);
    const h = (head || []).map(norm).join(' | ');
    if (/(^| )(icolcap|hcolsel|icolrisk|gxtescol|ietf)|etf/.test(n)) return 'etf';
    if (/(opcion|option|(^| )(call|put)( |$))/.test(n)) return 'opcion';
    if (/(futur|(^| )fut( |$))/.test(n) || /liquidacion/.test(h)) return 'futuro';
    if (/(coltes|colibr|colcap|coleqty|colir|colsc|msci|(^| )(indice|index)( |$))/.test(n)) return 'indice';
    if (/(^| )cdt/.test(n)) return 'cdt';
    if (/(^| )(tes|tfit|tuvt|tcop|tfi|tco)/.test(n)) return 'tes';
    if (/(usd|eur|cop x|copx|trm|dolar|divisa|(^| )fx( |$))/.test(n) || FX_PRICE.test(h)) return 'divisa';
    if (/(bono|bond)/.test(n) || FI_PRICE.test(h) || RATE_HDR.test(h)) return 'bono';
    if (MARKET_RE.test(name)) return 'indice';
    return 'accion';
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

  /* Une varios historiales en una tabla por periodo.
   *   agg 'last': último precio del periodo;  'avg': promedio de los precios del periodo,
   *   que suaviza fechas que no coinciden entre activos (como la hoja guía del curso).
   * Se conservan todos los periodos con al menos dos activos. Por defecto (fill) los huecos se
   * completan con el último precio anterior del mismo activo; antes de su primer dato quedan en NaN.
   * En datos diarios se quitan los días en que casi ningún activo cambió de precio
   * (festivos en que la plataforma repite el cierre anterior). */
  function mergeSeries(list, freq, opts) {
    const o = Object.assign({ agg: 'last' }, opts);
    if (list.length < 2) throw new Error('Se necesitan al menos dos activos: tus acciones y el índice de mercado.');
    const used = {};
    const names = list.map((s) => {
      const n = s.name;
      used[n] = (used[n] || 0) + 1;
      return used[n] > 1 ? n + ' (' + used[n] + ')' : n;
    });
    const maps = list.map((s) => {
      const g = new Map();
      s.dates.forEach((d, i) => {
        const k = periodKey(d, freq);
        if (!g.has(k)) g.set(k, { last: d, v: [] });
        const e = g.get(k);
        if (d >= e.last) e.last = d;
        e.v.push([d, s.prices[i]]);
      });
      const m = new Map();
      for (const [k, e] of g) {
        e.v.sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const val = o.agg === 'avg' ? e.v.reduce((q, x) => q + x[1], 0) / e.v.length : e.v[e.v.length - 1][1];
        m.set(k, [e.last, val]);
      }
      return m;
    });
    const all = new Set();
    maps.forEach((m) => m.forEach((_, k) => all.add(k)));
    let keys = [...all].filter((k) => maps.filter((m) => m.has(k)).length >= 2).sort();
    let holidays = [];
    if (freq === 'diaria' && list.length >= 4) {
      const keep = [];
      keys.forEach((k, i) => {
        if (i === 0) return keep.push(k);
        const prev = keep[keep.length - 1];
        const both = maps.filter((m) => m.has(k) && m.has(prev));
        const changed = both.filter((m) => m.get(k)[1] !== m.get(prev)[1]).length;
        if (both.length >= 4 && changed <= 1) holidays.push(k);
        else keep.push(k);
      });
      keys = keep;
    }
    if (keys.length < 3) throw new Error('Los activos casi no tienen periodos en común. Revisa que cubran las mismas fechas.');
    const dates = keys.map((k) => maps.reduce((a, m) => (m.has(k) && m.get(k)[0] > a ? m.get(k)[0] : a), ''));
    const values = maps.map((m) => keys.map((k) => (m.has(k) ? m.get(k)[1] : NaN)));
    // Días (o periodos) sin negociación: el último precio se mantiene hasta el siguiente día
    // hábil. Se completa desde la primera fecha de cada activo hasta la más reciente; antes de
    // que empiece a cotizar (p. ej. un activo listado hace poco) queda vacío.
    const filled = values.map(() => 0);
    if (o.fill !== false) {
      values.forEach((c, j) => {
        let last = NaN;
        for (let t = 0; t < c.length; t++) {
          if (Number.isFinite(c[t])) last = c[t];
          else if (Number.isFinite(last)) {
            c[t] = last;
            filled[j]++;
          }
        }
      });
    }
    const coverage = values.map((c) => c.filter(Number.isFinite).length);
    const common = keys.filter((k, t) => values.every((c) => Number.isFinite(c[t]))).length;
    return { names, dates, values, dropped: 0, coverage, common, holidays, filled, sep: ',', decimalComma: false };
  }

  /* Detecta series corridas en el tiempo respecto a las demás (pasa cuando se pegan
   * columnas de descargas distintas junto a una sola columna de fechas). Compara los
   * rendimientos diarios de cada serie con el promedio de las otras en desfases de
   * −25 a 25 filas. Devuelve las series cuyo mejor desfase es claramente distinto de 0. */
  function detectLags(list) {
    if (list.length < 3) return [];
    const dates = [...new Set(list.flatMap((s) => s.dates))].sort();
    if (dates.length < 60) return [];
    const gaps = dates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dates[i])) / 864e5).sort((a, b) => a - b);
    if (gaps[Math.floor(gaps.length / 2)] > 4) return []; // solo datos diarios
    const idx = new Map(dates.map((d, i) => [d, i]));
    // Solo series diarias de precios: las de tasa (renta fija) y las semanales o mensuales no se evalúan
    const daily = list.map((s) => {
      if (s.kind === 'tasa' || s.dates.length < 40) return false;
      const g = s.dates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(s.dates[i])) / 864e5).sort((a, b) => a - b);
      return g[Math.floor(g.length / 2)] <= 4;
    });
    const R = list.map((s, k) => {
      const r = new Array(dates.length).fill(NaN);
      if (!daily[k]) return r;
      for (let i = 1; i < s.dates.length; i++) {
        const a = idx.get(s.dates[i - 1]);
        const b = idx.get(s.dates[i]);
        if (b - a <= 5 && s.prices[i - 1] > 0 && s.prices[i] > 0) r[b] = Math.log(s.prices[i] / s.prices[i - 1]);
      }
      return r;
    });
    const corrAt = (x, y, lag) => {
      const a = [];
      const b = [];
      for (let t = 0; t < x.length; t++) {
        const u = t + lag;
        if (u < 0 || u >= y.length || !Number.isFinite(x[t]) || !Number.isFinite(y[u])) continue;
        a.push(x[t]);
        b.push(y[u]);
      }
      if (a.length < 40) return NaN;
      return covariance(a, b) / Math.sqrt(variance(a) * variance(b));
    };
    const out = [];
    list.forEach((s, k) => {
      if (!daily[k]) return;
      const cons = dates.map((_, t) => {
        const v = R.filter((_, j) => j !== k).map((r) => r[t]).filter(Number.isFinite);
        return v.length >= 2 ? v.reduce((q, x) => q + x, 0) / v.length : NaN;
      });
      let best = 0;
      let bestC = -Infinity;
      for (let lag = -25; lag <= 25; lag++) {
        const c = corrAt(R[k], cons, lag);
        if (c > bestC) {
          bestC = c;
          best = lag;
        }
      }
      const c0 = corrAt(R[k], cons, 0);
      if (Math.abs(best) >= 2 && bestC >= 0.15 && bestC - c0 >= 0.1) out.push({ name: s.name, lag: best, corr: bestC, corr0: c0 });
    });
    return out;
  }

  /* De vuelta a CSV (para mostrar y guardar el resultado de la unión). */
  function toCSV(p) {
    const q = (s) => (/[",;\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s);
    const rows = [['Fecha'].concat(p.names).map(q).join(',')];
    p.dates.forEach((d, t) => rows.push([d].concat(p.values.map((c) => (Number.isFinite(c[t]) ? +c[t].toPrecision(10) : ''))).join(',')));
    return rows.join('\n');
  }


  const MARKET_RE = /(mercado|market|[íi]ndice|index|benchmark|colcap|coleqty|ipc|s&p|sp ?500|spx|ibex|merval|bovespa|ibov|ipsa|colcap|msci|nasdaq|dow|acwi|^spy$)/i;
  /* Precio de compra de una fecha: el cierre de ese día si hubo negociación; si no
   * (festivo, fin de semana, día sin negociación), el último cierre anterior.
   * dates: ISO ascendentes (también acepta 'AAAA-MM', que se toma como el día 1).
   * Devuelve { price, date, exact } o { error }. */
  function priceOn(dates, prices, iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return { error: 'Escribe una fecha de compra.' };
    const d = dates.map((x) => (/^\d{4}-\d{2}$/.test(x) ? x + '-01' : x));
    if (!d.length) return { error: 'No hay precios de este activo.' };
    if (iso < d[0]) return { error: `No hay precios antes del ${d[0]}; la fecha de compra es anterior al inicio de los datos.` };
    let lo = 0;
    let hi = d.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (d[mid] <= iso) lo = mid;
      else hi = mid - 1;
    }
    if (iso > d[d.length - 1]) return { price: prices[lo], date: d[lo], exact: false, after: true };
    return { price: prices[lo], date: d[lo], exact: d[lo] === iso };
  }

  const isMarketName = (n) => MARKET_RE.test(n);
  function guessMarket(names) {
    // Primero el MSCI COLCAP (no el ETF ICOLCAP), luego cualquier índice de renta variable
    const c = names.findIndex((n) => /(^|[^i])colcap/i.test(n));
    if (c >= 0) return c;
    const i = names.findIndex((n) => MARKET_RE.test(n) && !/(coltes|colibr)/i.test(n));
    return i >= 0 ? i : names.length - 1;
  }

  Object.assign(PF, {
    stats: { sum, mean, dot, matVec, quad, covariance, variance, covMatrix, corrFromCov, solve, regress, pValue, normalCdf, eigSym, nearestCorr },
    data: { assetKey, CLASSES, DEFAULT_DUR, classify, rateIndex, priceOn, isMarketName, parseCSV, parseNumber, toReturns, guessMarket, isSingleAsset, parseSeriesFile, parseSeriesText, seriesFromRows, wideSeriesFromRows, readRows, readText, hasDates, combineSeries, mergeSeries, detectLags, toCSV, periodKey },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
