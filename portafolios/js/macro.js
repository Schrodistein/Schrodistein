/* Variables macroeconómicas de Colombia (PIB, inflación, desempleo y TRM) y su relación
 * con el mercado de valores.
 *
 * Fuentes (la app de escritorio las descarga; en la web se importan los archivos):
 *   PIB         FRED/OECD trimestral (crecimiento anual real) → Banco Mundial anual
 *   Inflación   FRED/OECD mensual (IPC, variación anual)      → Banco Mundial anual
 *   Desempleo   FRED/OECD mensual (tasa)                      → Banco Mundial anual
 *   TRM         datos.gov.co (Superfinanciera, diaria)        → FRED/OECD mensual → Banco Mundial anual
 * Relación con el mercado (modelo de factores macroeconómicos de Chen, Roll y Ross, 1986):
 *   rₘ,ₜ = a + b·xₜ + εₜ   con xₜ el cambio de la variable en el periodo. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;

  const VARS = {
    pib: {
      label: 'PIB',
      long: 'Crecimiento real del PIB (variación anual, %)',
      unit: '%',
      transform: 'level',
      xLabel: 'crecimiento del PIB (%)',
      expect: 1,
      theory: 'Más crecimiento significa más ventas y utilidades esperadas de las empresas, y el precio de una acción es el valor presente de esos flujos. Se espera relación positiva, aunque la bolsa suele anticiparse: reacciona antes de que el DANE publique el dato (Fama, 1990; Chen, Roll y Ross, 1986).',
    },
    inflacion: {
      label: 'Inflación',
      long: 'Inflación anual del IPC (%)',
      unit: '%',
      transform: 'diff',
      xLabel: 'cambio de la inflación (puntos)',
      expect: -1,
      theory: 'Una inflación que sube lleva al Banco de la República a subir su tasa. Eso encarece la deuda de las empresas y aumenta la tasa con que se descuentan sus flujos, así que las acciones caen. Fama y Schwert (1977) y Fama (1981) documentan esa relación negativa; según la hipótesis de Fama, la inflación es un indicador de menor actividad real.',
    },
    desempleo: {
      label: 'Desempleo',
      long: 'Tasa de desempleo (%)',
      unit: '%',
      transform: 'diff',
      xLabel: 'cambio del desempleo (puntos)',
      expect: -1,
      theory: 'Más desempleo indica una economía más débil, con menos consumo y utilidades, y se espera relación negativa. Boyd, Hu y Jagannathan (2005) muestran que el signo puede cambiar: en expansión, una noticia de más desempleo anticipa tasas de interés más bajas y puede subir la bolsa.',
    },
    trm: {
      label: 'TRM',
      long: 'Tasa representativa del mercado (pesos por dólar)',
      unit: 'COP',
      transform: 'pct',
      xLabel: 'variación de la TRM (%)',
      expect: -1,
      theory: 'En Colombia el peso se deprecia cuando los inversionistas extranjeros salen del país o cae el petróleo, y en esos momentos también cae la bolsa. Por eso se espera relación negativa con el índice (Dornbusch y Fischer, 1980, modelo orientado a flujos). Las empresas exportadoras o con ingresos en dólares, como Ecopetrol, pueden ganar con un dólar alto.',
    },
  };

  const SOURCES = {
    pib: [
      { kind: 'fred', id: 'NAEXKP01COQ659S', note: 'FRED (OCDE): PIB real, variación anual, trimestral' },
      { kind: 'wb', id: 'NY.GDP.MKTP.KD.ZG', note: 'Banco Mundial: crecimiento del PIB real, anual' },
    ],
    inflacion: [
      { kind: 'fred', id: 'CPALTT01COM659N', note: 'FRED (OCDE): IPC, variación anual, mensual' },
      { kind: 'wb', id: 'FP.CPI.TOTL.ZG', note: 'Banco Mundial: inflación del IPC, anual' },
    ],
    desempleo: [
      { kind: 'fred', id: 'LRHUTTTTCOM156S', note: 'FRED (OCDE): tasa de desempleo, mensual, desestacionalizada' },
      { kind: 'wb', id: 'SL.UEM.TOTL.ZS', note: 'Banco Mundial: desempleo (OIT), anual' },
    ],
    trm: [
      { kind: 'socrata', id: '32sa-8pi3', note: 'datos.gov.co (Superintendencia Financiera): TRM diaria' },
      { kind: 'fred', id: 'CCUSMA02COM618N', note: 'FRED (OCDE): pesos por dólar, promedio mensual' },
      { kind: 'wb', id: 'PA.NUS.FCRF', note: 'Banco Mundial: tasa de cambio oficial, promedio anual' },
    ],
  };

  function sourceUrl(src) {
    if (src.kind === 'fred') return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${src.id}`;
    if (src.kind === 'wb') return `https://api.worldbank.org/v2/country/COL/indicator/${src.id}?format=json&per_page=200&date=1990:2030`;
    if (src.kind === 'socrata') return `https://www.datos.gov.co/resource/${src.id}.json?$select=vigenciadesde,valor&$order=vigenciadesde&$limit=60000`;
    return '';
  }

  /* ---------- Lectores ---------- */
  function sortPts(pts) {
    pts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const d = pts.filter((p, i) => i === pts.length - 1 || p[0] !== pts[i + 1][0]);
    return { dates: d.map((p) => p[0]), values: d.map((p) => p[1]) };
  }
  // FRED: «observation_date,ID» (o «DATE,ID»); los faltantes vienen como «.»
  function parseFred(text) {
    const lines = String(text).replace(/^﻿/, '').trim().split(/\r?\n/);
    if (lines.length < 2 || !/date/i.test(lines[0])) throw new Error('respuesta de FRED sin encabezado de fecha');
    const pts = [];
    for (const l of lines.slice(1)) {
      const [d, v] = l.split(',');
      const x = parseFloat(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && fin(x)) pts.push([d, x]);
    }
    if (pts.length < 3) throw new Error('FRED no devolvió datos');
    return sortPts(pts);
  }
  // Banco Mundial: [ {página}, [ { date: '2023', value: 0.6 }, … ] ]
  function parseWorldBank(json) {
    const rows = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : null;
    if (!rows) throw new Error(json && json[0] && json[0].message ? 'Banco Mundial: ' + JSON.stringify(json[0].message) : 'respuesta del Banco Mundial sin datos');
    const pts = rows.filter((r) => /^\d{4}$/.test(r.date) && fin(r.value)).map((r) => [r.date + '-12-31', +r.value]);
    if (pts.length < 3) throw new Error('el Banco Mundial no devolvió datos');
    return sortPts(pts);
  }
  // datos.gov.co (Socrata): [ { vigenciadesde: '2024-01-02T00:00:00.000', valor: '3822.05' }, … ]
  function parseSocrata(json) {
    if (!Array.isArray(json)) throw new Error('respuesta de datos.gov.co inválida');
    const pts = json.map((r) => [String(r.vigenciadesde || r.fecha || '').slice(0, 10), parseFloat(String(r.valor).replace(/,/g, ''))]).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p[0]) && p[1] > 0);
    if (pts.length < 3) throw new Error('datos.gov.co no devolvió la TRM');
    return sortPts(pts);
  }
  // Archivo propio (DANE, Banco de la República…): columna de fecha y una de valor
  function parseFile(text, name) {
    const rows = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (rows.length < 3) throw new Error(`«${name}» no tiene datos suficientes`);
    const sep = [';', '\t', ','].find((c) => rows[0].includes(c)) || ',';
    const head = rows[0].split(sep).map((h) => h.trim().toLowerCase());
    let di = head.findIndex((h) => /fecha|date|periodo|año|ano|mes/.test(h));
    if (di < 0) di = 0;
    const vi = head.findIndex((h, i) => i !== di);
    const cells = rows.slice(1).map((l) => l.split(sep));
    const dc = cells.some((c) => /,\d/.test(c[vi] || '') && !/\./.test(c[vi] || ''));
    const pts = [];
    for (const c of cells) {
      const d = normDate(String(c[di] || '').trim());
      let v = String(c[vi] || '').trim().replace(/[%\s$]/g, '');
      v = dc ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
      const x = parseFloat(v);
      if (d && fin(x)) pts.push([d, x]);
    }
    if (pts.length < 3) throw new Error(`En «${name}» no se reconocieron fechas y valores`);
    return sortPts(pts);
  }
  function normDate(t) {
    let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = t.match(/^(\d{4})[-/.](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-28`;
    m = t.match(/^(\d{4})[-/ ]?(t|q)([1-4])$/i);
    if (m) return `${m[1]}-${String(+m[3] * 3).padStart(2, '0')}-28`;
    m = t.match(/^(\d{4})$/);
    if (m) return `${m[1]}-12-31`;
    return null;
  }

  /* ---------- Frecuencia y agregación ---------- */
  function freqOf(dates) {
    if (dates.length < 2) return 'A';
    const g = dates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dates[i])) / 864e5).sort((a, b) => a - b);
    const med = g[Math.floor(g.length / 2)];
    return med <= 7 ? 'D' : med <= 40 ? 'M' : med <= 120 ? 'Q' : 'A';
  }
  const FREQ_NAME = { D: 'diaria', M: 'mensual', Q: 'trimestral', A: 'anual' };
  const keyOf = (iso, f) => {
    const y = iso.slice(0, 4);
    const m = +iso.slice(5, 7);
    return f === 'A' ? y : f === 'Q' ? `${y}-T${Math.ceil(m / 3)}` : iso.slice(0, 7);
  };
  const nextKey = (k, f) => {
    if (f === 'A') return String(+k + 1);
    if (f === 'Q') {
      const [y, q] = [+k.slice(0, 4), +k.slice(6)];
      return q === 4 ? `${y + 1}-T1` : `${y}-T${q + 1}`;
    }
    const [y, m] = [+k.slice(0, 4), +k.slice(5, 7)];
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  };
  // Valor por periodo: promedio (datos diarios, como la TRM) o último dato del periodo
  function byPeriod(dates, values, f, avg) {
    const g = new Map();
    dates.forEach((d, i) => {
      if (!fin(values[i])) return;
      const k = keyOf(d, f);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(values[i]);
    });
    const out = new Map();
    for (const [k, v] of g) out.set(k, avg ? v.reduce((a, b) => a + b, 0) / v.length : v[v.length - 1]);
    return out;
  }
  // Cambio entre periodos consecutivos: log-rendimiento ('pct'), diferencia ('diff') o nivel
  function changes(map, f, how) {
    const out = new Map();
    for (const [k, v] of map) {
      if (how === 'level') {
        out.set(k, v);
        continue;
      }
      const prevKey = [...map.keys()].find((q) => nextKey(q, f) === k);
      if (prevKey == null) continue;
      const p = map.get(prevKey);
      const x = how === 'pct' ? (p > 0 && v > 0 ? Math.log(v / p) : NaN) : v - p;
      if (fin(x)) out.set(k, x);
    }
    return out;
  }

  /* Relación de una serie de precios (índice o activo) con una variable macro.
   * price: { dates, prices }. Devuelve n, ρ, b, t, p, R² y las correlaciones con un periodo
   * de adelanto y de rezago de la variable. */
  function relate(price, macro, key) {
    const V = VARS[key];
    const fNative = freqOf(macro.dates);
    const f = fNative === 'D' ? 'M' : fNative;
    const xMap = changes(byPeriod(macro.dates, macro.values, f, fNative === 'D'), f, V.transform);
    const rMap = changes(byPeriod(price.dates, price.prices, f, false), f, 'pct');
    const keys = [...rMap.keys()].filter((k) => xMap.has(k)).sort();
    const r = keys.map((k) => rMap.get(k));
    const x = keys.map((k) => xMap.get(k) * (V.transform === 'pct' ? 100 : 1));
    const out = { key, freq: f, n: keys.length, keys, r, x, from: keys[0], to: keys[keys.length - 1] };
    if (keys.length < 4) return Object.assign(out, { ok: false });
    const S = PF.stats;
    const vr = S.variance(r);
    const vx = S.variance(x);
    out.corr = vr > 0 && vx > 0 ? S.covariance(r, x) / Math.sqrt(vr * vx) : NaN;
    const reg = S.regress(r, x);
    Object.assign(out, { ok: true, b: reg.beta, a: reg.alpha, t: reg.seBeta > 0 ? reg.beta / reg.seBeta : NaN, r2: reg.r2 });
    out.p = fin(out.t) ? S.pValue(out.t, keys.length - 2) : NaN;
    // Adelanto: ¿el mercado de hoy se mueve con la variable del periodo siguiente?
    const lag = (dk) => {
      const a = [];
      const b = [];
      keys.forEach((k) => {
        const k2 = dk > 0 ? nextKey(k, f) : [...xMap.keys()].find((q) => nextKey(q, f) === k);
        if (k2 != null && xMap.has(k2)) {
          a.push(rMap.get(k));
          b.push(xMap.get(k2));
        }
      });
      if (a.length < 4) return NaN;
      return S.covariance(a, b) / Math.sqrt(S.variance(a) * S.variance(b));
    };
    out.lead = lag(1);
    out.lagged = lag(-1);
    return out;
  }

  function interpret(res, key, marketName) {
    const V = VARS[key];
    if (!res.ok) return `Hay ${res.n} periodos en común con ${marketName}; se necesitan al menos 4. Carga más historia del índice o de la variable.`;
    const nf = (x, d = 2) => (fin(x) ? x.toFixed(d).replace('.', ',') : '—');
    const strength = Math.abs(res.corr) >= 0.5 ? 'fuerte' : Math.abs(res.corr) >= 0.3 ? 'moderada' : Math.abs(res.corr) >= 0.1 ? 'débil' : 'prácticamente nula';
    const sig = res.p < 0.05 ? 'estadísticamente significativa al 5 %' : res.p < 0.1 ? 'significativa solo al 10 %' : 'no significativa con estos datos';
    const sign = res.corr > 0 ? 'positiva' : 'negativa';
    const asExp = Math.sign(res.corr) === V.expect;
    const unit = { pib: '1 punto más de crecimiento del PIB', inflacion: '1 punto de aumento de la inflación', desempleo: '1 punto de aumento del desempleo', trm: '1 % de aumento de la TRM' }[key];
    let txt = `Relación ${sign} ${strength} (ρ = ${nf(res.corr)}), ${sig} (t = ${nf(res.t)}, p = ${nf(res.p, 3)}, n = ${res.n} periodos ${FREQ_NAME[res.freq]}es). Por cada ${unit}, el rendimiento de ${marketName} cambió en promedio ${nf(res.b * 100)} puntos porcentuales; la variable explica el ${nf(res.r2 * 100, 1)} % de sus movimientos (R²). `;
    txt += asExp ? 'El signo coincide con lo que espera la teoría.' : 'El signo es contrario a lo que espera la teoría; con pocos datos puede ser casualidad o reflejar otros factores del periodo.';
    if (fin(res.lead) && Math.abs(res.lead) > Math.abs(res.corr) + 0.1) txt += ` La correlación con el dato del periodo siguiente es mayor (${nf(res.lead)}): el mercado parece anticiparse.`;
    return txt;
  }

  /* ---------- Gráficos ---------- */
  function lineChart(dates, values, o) {
    const W = o.width || 320;
    const H = o.height || 120;
    const pad = { l: 44, r: 8, t: 8, b: 20 };
    const xs = dates.map((d) => Date.parse(d));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    const X = (t) => pad.l + ((t - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
    const path = values.map((v, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const fmt = (v) => (Math.abs(span) >= 100 ? Math.round(v).toLocaleString('es-CO') : v.toFixed(1).replace('.', ','));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${o.label || ''}">`;
    for (const v of [lo, (lo + hi) / 2, hi]) s += `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tk" x="${pad.l - 4}" y="${Y(v) + 3}" text-anchor="end">${fmt(v)}</text>`;
    s += `<text class="tk" x="${pad.l}" y="${H - 4}">${dates[0].slice(0, 7)}</text><text class="tk" x="${W - pad.r}" y="${H - 4}" text-anchor="end">${dates[dates.length - 1].slice(0, 7)}</text>`;
    s += `<path d="${path}" fill="none" stroke="var(--s1)" stroke-width="1.6"/></svg>`;
    return s;
  }
  function scatter(res, o) {
    const W = o.width || 320;
    const H = o.height || 160;
    const pad = { l: 44, r: 8, t: 8, b: 28 };
    const xl = Math.min(...res.x);
    const xh = Math.max(...res.x);
    const yl = Math.min(...res.r);
    const yh = Math.max(...res.r);
    const X = (v) => pad.l + ((v - xl) / (xh - xl || 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yl) / (yh - yl || 1)) * (H - pad.t - pad.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Dispersión">`;
    s += `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(Math.max(yl, Math.min(yh, 0)))}" y2="${Y(Math.max(yl, Math.min(yh, 0)))}"/>`;
    res.x.forEach((x, i) => (s += `<circle cx="${X(x).toFixed(1)}" cy="${Y(res.r[i]).toFixed(1)}" r="3" fill="var(--asset)" opacity="0.8"/>`));
    if (fin(res.b)) s += `<line x1="${X(xl)}" x2="${X(xh)}" y1="${Y(res.a + res.b * xl)}" y2="${Y(res.a + res.b * xh)}" stroke="var(--s2)" stroke-width="1.6"/>`;
    s += `<text class="tk" x="${(W + pad.l) / 2}" y="${H - 6}" text-anchor="middle">${o.xLabel || ''}</text><text class="tk" x="10" y="${pad.t + 8}">rₘ</text></svg>`;
    return s;
  }

  /* ---------- Pantalla ---------- */
  function render(ctx) {
    const { data, market, assets, esc } = ctx;
    const width = ctx.width || 340;
    const nf = (x, d = 2) => (fin(x) ? x.toFixed(d).replace('.', ',') : '—');
    const cards = [];
    const results = {};
    for (const key of Object.keys(VARS)) {
      const V = VARS[key];
      const d = data && data[key];
      if (!d || !d.dates || d.dates.length < 3) {
        cards.push(`<article class="macro-card"><h3>${V.long}</h3><p class="sub">Sin datos todavía. ${ctx.desktop ? 'Pulsa «Actualizar variables macro».' : 'Impórtala con un archivo (fecha y valor) del DANE, el Banco de la República o el Banco Mundial.'}</p><p class="hint">${V.theory}</p></article>`);
        continue;
      }
      const last = d.values[d.values.length - 1];
      const res = market ? relate(market, d, key) : null;
      results[key] = res;
      cards.push(`<article class="macro-card">
        <h3>${V.long}</h3>
        <div class="macro-now"><b>${key === 'trm' ? Math.round(last).toLocaleString('es-CO') : nf(last)}${key === 'trm' ? '' : ' %'}</b><span class="sub">${esc(d.dates[d.dates.length - 1])} · ${FREQ_NAME[freqOf(d.dates)]} · ${d.dates.length} datos desde ${esc(d.dates[0].slice(0, 7))}</span></div>
        ${lineChart(d.dates, d.values, { width, label: V.long })}
        <p class="sub">Fuente: ${esc(d.source || 'archivo importado')}${d.updated ? ` · descargada el ${esc(String(d.updated).slice(0, 10))}` : ''}</p>
        ${res && res.ok ? scatter(res, { width, xLabel: V.xLabel }) : ''}
        ${res ? `<p>${esc(interpret(res, key, market.name))}</p>` : '<p class="sub">Carga el índice de mercado para ver la relación.</p>'}
        <details><summary>Qué dice la teoría</summary><p class="hint">${V.theory}</p></details>
      </article>`);
    }
    // Correlación de cada activo con cada variable (sensibilidades de Chen, Roll y Ross)
    let table = '';
    const keys = Object.keys(VARS).filter((k) => data && data[k] && data[k].dates && data[k].dates.length >= 3);
    if (keys.length && assets && assets.length) {
      const rows = [market].concat(assets).filter(Boolean).map((a) => {
        const cells = keys.map((k) => {
          const r = relate(a, data[k], k);
          if (!r.ok) return '<td class="n">—</td>';
          const cl = r.p < 0.05 ? (r.corr > 0 ? 'pos' : 'neg') : '';
          return `<td class="n ${cl}" title="b = ${nf(r.b * 100)} pp · t = ${nf(r.t)} · n = ${r.n}">${nf(r.corr)}${r.p < 0.05 ? ' *' : ''}</td>`;
        });
        return `<tr${a === market ? ' class="hl"' : ''}><td>${esc(a.name)}${a === market ? ' (índice)' : ''}</td>${cells.join('')}</tr>`;
      });
      table = `<div class="table-scroll"><table class="data"><thead><tr><th>Activo</th>${keys.map((k) => `<th class="n">${VARS[k].label}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>
        <p class="hint">Correlación de Pearson entre el rendimiento de cada activo y el cambio de cada variable, en la frecuencia de la variable. * = significativa al 5 %; en verde las positivas y en rojo las negativas. Pasa el cursor sobre un número para ver la sensibilidad b (puntos de rendimiento por unidad de la variable) y su t.</p>`;
    }
    return { cards: cards.join(''), table, results };
  }

  /* Tabla larga (fecha, variable, valor, fuente) para descargar o guardar en la biblioteca. */
  function toCSV(data) {
    const rows = ['Variable,Fecha,Valor,Unidad,Fuente'];
    for (const k of Object.keys(VARS)) {
      const d = data && data[k];
      if (!d || !d.dates) continue;
      d.dates.forEach((t, i) => rows.push(`${k},${t},${d.values[i]},${VARS[k].unit},"${String(d.source || '').replace(/"/g, "'")}"`));
    }
    return rows.join('\n');
  }

  PF.macro = { VARS, SOURCES, sourceUrl, parseFred, parseWorldBank, parseSocrata, parseFile, freqOf, byPeriod, changes, relate, interpret, render, toCSV, lineChart };
})(typeof globalThis !== 'undefined' ? globalThis : this);
