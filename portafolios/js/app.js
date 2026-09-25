/* Controlador de la interfaz. */
(function () {
  'use strict';
  const PF = globalThis.PF;
  const C = PF.charts;
  const { esc, pct, num, f1 } = C;
  const $ = (id) => document.getElementById(id);

  const PORTS = [
    { key: 'tangency', label: 'Recomendado', short: 'Recomendado', title: 'Portafolio recomendado: máxima razón de Sharpe', desc: 'El portafolio tangente: la mayor prima por unidad de riesgo total dentro de tus límites de peso. Es el portafolio riesgoso eficiente que recomienda la teoría de Markowitz y Sharpe; para menos riesgo, combínalo con el activo libre de riesgo sobre la línea del mercado de capitales.' },
    { key: 'minVar', label: 'Mínima varianza', short: 'Mín. varianza', title: 'Portafolio de mínima varianza', desc: 'El punto de menor riesgo de la frontera eficiente. No usa los rendimientos esperados, así que es el más robusto al error de estimación de las medias.' },
    { key: 'maxDiv', label: 'Máxima diversificación', short: 'Máx. diversif.', shape: 'diamond', title: 'Portafolio de máxima diversificación', desc: 'Maximiza la razón de diversificación Σwσ / σp: el mayor beneficio de combinar activos poco correlacionados.' },
    { key: 'riskParity', label: 'Paridad de riesgo', short: 'Paridad', shape: 'diamond', title: 'Portafolio de paridad de riesgo', desc: 'Cada activo aporta la misma parte del riesgo total. No aplica tus límites de peso.' },
    { key: 'equal', label: 'Pesos iguales', short: '1/N', shape: 'diamond', title: 'Portafolio de pesos iguales (1/N)', desc: 'La diversificación ingenua: el mismo peso en cada activo. Sirve de referencia; rara vez es eficiente.' },
  ];

  const st = { parsed: null, model: null, P: null, sel: 'tangency', userW: null, userNames: null, sort: { key: null, dir: -1 }, screen: 'frontera', err: null };

  /* ---------- Utilidades ---------- */
  const LOCALE = { COP: 'es-CO', USD: 'en-US', MXN: 'es-MX', EUR: 'es-ES' };
  const money = (x) => {
    if (!Number.isFinite(x)) return '—';
    const cur = ($('currency') && $('currency').value) || 'COP';
    return new Intl.NumberFormat(LOCALE[cur] || 'es-CO', { style: 'currency', currency: cur, currencyDisplay: 'symbol', maximumFractionDigits: 0 }).format(x);
  };
  const val = (id) => {
    const v = parseFloat(String($(id).value).replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  };
  const short = (s, k) => (s.length > k ? s.slice(0, k - 1) + '…' : s);
  const store = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem('pf.' + k));
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('pf.' + k, JSON.stringify(v));
      } catch (e) {
        /* sin almacenamiento: no pasa nada */
      }
    },
  };
  const ICON = {
    good: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15"/><path d="M5.5 10.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15"/><path d="M10 5.5v5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14.3" r="1.2" fill="currentColor"/></svg>',
    bad: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15"/><path d="M6.5 6.5l7 7M13.5 6.5l-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  function settings() {
    return {
      kind: $('kind').value,
      freq: $('freq').value,
      market: $('market').selectedIndex,
      rf: (val('rf') ?? 0) / 100,
      marketReturn: val('em') == null ? null : val('em') / 100,
      muModel: $('mumodel').value,
      covModel: $('covmodel').value,
      wmin: (val('wmin') ?? 0) / 100,
      wmax: (val('wmax') ?? 100) / 100,
      capital: val('capital') ?? 0,
    };
  }
  const SETTING_IDS = ['kind', 'freq', 'rf', 'em', 'mumodel', 'covmodel', 'wmin', 'wmax', 'capital', 'currency', 'tol'];

  function showBanner(msg, kind) {
    const b = $('banner');
    b.hidden = !msg;
    b.className = 'banner' + (kind === 'warn' ? ' warn' : '');
    b.textContent = msg || '';
  }

  /* ---------- Datos ---------- */
  function parse(keepMarket) {
    try {
      st.parsed = PF.data.parseCSV($('csv').value);
    } catch (e) {
      st.parsed = null;
      st.model = null;
      showBanner(e.message);
      renderEmpty();
      return;
    }
    const p = st.parsed;
    const sel = $('market');
    const prev = keepMarket ? sel.value : null;
    sel.innerHTML = p.names.map((n, i) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    const guess = PF.data.guessMarket(p.names);
    sel.selectedIndex = prev && p.names.includes(prev) ? p.names.indexOf(prev) : guess;
    $('data-meta').textContent = `${p.names.length} columnas numéricas · ${p.dates.length} filas${p.dates.length ? ` (${p.dates[0]} a ${p.dates[p.dates.length - 1]})` : ''}${p.dropped ? ` · ${p.dropped} filas descartadas por celdas vacías o no numéricas` : ''}.${st.series && $('csv').value === st.mergedText ? ' ' + st.mergeNote : ''}`;
    store.set('csv', $('csv').value);
    compute();
  }

  function compute() {
    if (!st.parsed) return;
    const s = settings();
    store.set('settings', Object.fromEntries(SETTING_IDS.map((id) => [id, $(id).value])));
    const p = st.parsed;
    const warnings = [];
    try {
      const R = PF.data.toReturns(p.values, s.kind);
      const mi = s.market;
      const names = p.names.filter((_, i) => i !== mi);
      const n = names.length;
      if (s.wmax * n < 1 - 1e-9) {
        warnings.push(`Con ${n} activos un peso máximo de ${nf1(s.wmax * 100)} % no alcanza para sumar 100 %; se usa ${nf1(100 / n)} %, que obliga a pesos iguales. Sube el peso máximo o agrega activos.`);
        s.wmax = 1 / n;
      }
      if (s.wmin * n > 1 + 1e-9) throw new Error(`Con ${n} activos el peso mínimo no puede pasar de ${nf1(100 / n)} %.`);
      if (s.wmin > s.wmax) throw new Error('El peso mínimo es mayor que el máximo.');
      const datos = { names, returns: R.filter((_, i) => i !== mi), market: R[mi], marketName: p.names[mi], dates: p.dates };
      const m = PF.model.build(datos, { freq: s.freq, rf: s.rf, muModel: s.muModel, covModel: s.covModel, marketReturn: s.marketReturn });
      if (m.singular && s.covModel === 'sample') warnings.push('Hay menos periodos que activos: la covarianza muestral es singular. Elige el modelo de índice único de Sharpe.');
      else if (m.T < 36) warnings.push(`Solo hay ${m.T} periodos. Con menos de 36 las estimaciones son muy inestables.`);
      const P = PF.model.portfolios(m, s.wmin, s.wmax);
      warnings.push(...P.warnings);
      st.model = m;
      st.P = P;
      st.s = s;
      if (!P[st.sel]) st.sel = P.tangency ? 'tangency' : 'maxDiv';
      const same = st.userNames && st.userNames.join('|') === names.join('|');
      if (!same) {
        const saved = store.get('userW');
        st.userW = saved && saved.names.join('|') === names.join('|') ? saved.w : equalRounded(n);
        st.userNames = names;
        renderWeightInputs();
      }
      showBanner(warnings.join(' '), 'warn');
      $('div-hint').textContent = `Con un peso máximo de ${nf1(s.wmax * 100)} % el portafolio tendrá al menos ${Math.ceil(1 / s.wmax - 1e-9)} activos.`;
      render();
    } catch (e) {
      st.model = null;
      showBanner(e.message);
      renderEmpty();
    }
  }
  const nf1 = (x) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(x);
  function equalRounded(n) {
    const w = new Array(n).fill(Math.floor(1000 / n) / 1000);
    w[0] += 1 - w.reduce((a, b) => a + b, 0);
    return w.map((x) => Math.round(x * 1e6) / 1e6);
  }

  /* Archivos subidos: una tabla ya armada, o historiales por activo
   * (BVC en Excel o CSV, Investing.com, Yahoo Finance). */
  function readFile(f, asBuffer) {
    return new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => ko(new Error(`No se pudo leer «${f.name}».`));
      if (asBuffer) r.readAsArrayBuffer(f);
      else r.readAsText(f);
    });
  }

  // SheetJS solo se descarga cuando se sube un Excel.
  const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  let sheetjs = null;
  function loadSheetJS() {
    if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
    if (!sheetjs) {
      sheetjs = new Promise((ok, ko) => {
        const sc = document.createElement('script');
        sc.src = SHEETJS;
        sc.onload = () => ok(globalThis.XLSX);
        sc.onerror = () => {
          sheetjs = null;
          ko(new Error('No se pudo cargar el lector de Excel (se necesita conexión a internet). También puedes guardar el archivo como CSV y subirlo.'));
        };
        document.head.appendChild(sc);
      });
    }
    return sheetjs;
  }
  const isExcel = (f) => /\.(xlsx|xlsm|xls|ods)$/i.test(f.name);

  async function seriesFromFile(f) {
    if (isExcel(f)) {
      const X = await loadSheetJS();
      const wb = X.read(new Uint8Array(await readFile(f, true)), { type: 'array', cellDates: true });
      const out = [];
      let lastErr = null;
      for (const name of wb.SheetNames) {
        const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
        try {
          out.push(...PF.data.seriesFromRows(rows, f.name));
        } catch (e) {
          lastErr = e;
        }
      }
      if (!out.length) throw lastErr || new Error(`«${f.name}» no tiene hojas con fechas y precios.`);
      return { series: out };
    }
    const text = await readFile(f, false);
    if (PF.data.isSingleAsset(text)) return { series: PF.data.parseSeriesText(text, f.name) };
    return { table: text };
  }

  async function loadFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    try {
      const parts = await Promise.all(files.map(seriesFromFile));
      const tables = parts.filter((p) => p.table != null);
      if (tables.length) {
        if (files.length > 1) throw new Error('Mezclaste una tabla con varios activos por columna y archivos de un solo activo. Sube solo la tabla, o solo los historiales.');
        st.series = null;
        $('csv').value = tables[0].table;
        st.userNames = null;
        parse(false);
        return;
      }
      st.series = PF.data.combineSeries(parts.flatMap((p) => p.series));
      if (st.series.length === 1) throw new Error(`Solo se encontró el historial de ${st.series[0].name}. Selecciona a la vez los archivos de todas tus acciones y del índice de mercado (por ejemplo el COLCAP).`);
      mergeLoaded(false);
    } catch (e) {
      showBanner(e.message);
    }
  }

  function mergeLoaded(keepMarket) {
    try {
      const freq = $('freq').value;
      const merged = PF.data.mergeSeries(st.series, freq);
      const text = PF.data.toCSV(merged);
      st.mergedText = text;
      const lostMax = Math.max(...merged.lost);
      st.mergeNote = `Se unieron ${st.series.length} activos (${st.series.map((x) => `${x.name}: «${x.column}»${x.parts > 1 ? `, ${x.parts} archivos` : ''}, ${x.dates[0]} a ${x.dates[x.dates.length - 1]}`).join('; ')}).${lostMax > 0 ? ` Se descartaron periodos que no estaban en todos los archivos (hasta ${lostMax} en uno).` : ''}`;
      $('csv').value = text;
      $('kind').value = 'prices';
      st.userNames = null;
      parse(keepMarket);
    } catch (e) {
      showBanner(e.message);
    }
  }

  /* ---------- Render ---------- */
  function renderEmpty() {
    $('summary').innerHTML = '';
    for (const id of ['assets-table', 'compare-table', 'confirm-table']) $(id).innerHTML = '';
    for (const id of ['chart-sml', 'chart-corr', 'chart-front', 'chart-confirm', 'port', 'tb', 'verdict', 'checks', 'legend-front', 'legend-confirm', 'pick']) $(id).innerHTML = '';
  }

  function rec() {
    return st.P.tangency || st.P.maxDiv;
  }

  function render() {
    renderSummary();
    renderAssetsTable();
    renderPick();
    renderPort();
    renderCompare();
    renderTB();
    renderConfirm();
    renderCharts();
  }

  function renderSummary() {
    const r = rec();
    $('summary').innerHTML = `<div class="wrap summary-in"><strong>Portafolio recomendado</strong>
      <span class="kv"><span>Rendimiento esperado</span><b>${pct(r.ret)}</b></span>
      <span class="kv"><span>Riesgo σ</span><b>${pct(r.vol)}</b></span>
      <span class="kv"><span>Sharpe</span><b>${num(r.sharpe)}</b></span>
      <span class="kv"><span>Activos</span><b>${r.nHeld}</b></span>
      <span class="kv"><span>N efectivo</span><b>${num(r.effN, 1)}</b></span></div>`;
  }

  function assetTip(a) {
    return `<b>${esc(a.name)}</b><br>E(R) <span class="num">${pct(a.expRet)}</span> · σ <span class="num">${pct(a.vol)}</span><br>β <span class="num">${num(a.beta)}</span> · Sharpe <span class="num">${num(a.sharpe)}</span><br>α de Jensen <span class="num">${pct(a.jensen, 2)}</span>`;
  }
  function portTip(label, e) {
    return `<b>${esc(label)}</b><br>E(R) <span class="num">${pct(e.ret)}</span> · σ <span class="num">${pct(e.vol)}</span><br>Sharpe <span class="num">${num(e.sharpe)}</span> · N efectivo <span class="num">${num(e.effN, 1)}</span>`;
  }

  function renderAssetsTable() {
    const m = st.model;
    const cols = [
      ['name', 'Activo', (a) => esc(a.name), false],
      ['expRet', 'E(R)', (a) => pct(a.expRet), true],
      ['histRet', 'Histórico', (a) => pct(a.histRet), true],
      ['vol', 'σ', (a) => pct(a.vol), true],
      ['beta', 'β', (a) => num(a.beta), true],
      ['jensen', 'α Jensen', (a) => pct(a.jensen, 2), true, (a) => (a.jensen >= 0 ? 'pos' : 'neg')],
      ['tAlpha', 't (α)', (a) => `${f1(a.tAlpha)}<span class="sub">p=${num(a.pAlpha, 2)}</span>`, true],
      ['sharpe', 'Sharpe', (a) => num(a.sharpe), true],
      ['treynor', 'Treynor', (a) => pct(a.treynor), true],
      ['r2', 'R²', (a) => num(a.r2), true],
    ];
    let rows = m.assets.slice();
    if (st.sort.key) rows.sort((a, b) => (st.sort.key === 'name' ? a.name.localeCompare(b.name) : a[st.sort.key] - b[st.sort.key]) * st.sort.dir);
    const head = cols.map(([k, t, , n]) => `<th class="sortable${n ? ' n' : ''}" data-sort="${k}" scope="col"${st.sort.key === k ? ` aria-sort="${st.sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${t}</th>`).join('');
    const body = rows.map((a) => `<tr>${cols.map(([, , f, n, cl]) => `<td class="${n ? 'n' : ''} ${cl ? cl(a) : ''}">${f(a)}</td>`).join('')}</tr>`).join('');
    const mk = `<tr class="hl"><td>${esc(m.marketName)} (mercado)</td><td class="n">${pct(m.Em)}</td><td class="n">${pct(m.mktHist)}</td><td class="n">${pct(m.mktVol)}</td><td class="n">${num(1)}</td><td class="n">${pct(0, 2)}</td><td class="n">—</td><td class="n">${num(m.mktSharpe)}</td><td class="n">${pct(m.Em - m.rf)}</td><td class="n">${num(1)}</td></tr>`;
    $('assets-table').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}${mk}</tbody>`;
  }

  function renderPick() {
    $('pick').innerHTML = PORTS.filter((p) => st.P[p.key])
      .map((p) => `<button type="button" role="tab" data-port="${p.key}" aria-selected="${p.key === st.sel}">${p.label}</button>`)
      .join('');
  }

  function tile(k, v, s) {
    return `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span>${s ? `<span class="s">${s}</span>` : ''}</div>`;
  }

  function renderPort() {
    const m = st.model;
    const def = PORTS.find((p) => p.key === st.sel);
    const e = st.P[st.sel];
    const cap = st.s.capital;
    const outB = st.sel === 'riskParity' && !st.P.riskParityInBounds ? ' <b>Nota:</b> este portafolio sale de tus límites de peso.' : '';
    const held = m.names.map((n, i) => ({ n, w: e.w[i] })).filter((x) => Math.abs(x.w) > 5e-4).sort((a, b) => b.w - a.w);
    $('port').innerHTML = `
      <div class="port-head">
        <div class="hero"><span class="k">Rendimiento esperado anual</span><span class="v">${pct(e.ret)}</span>
          <span class="s">IC 95 % de la media: ${pct(e.ciRet[0])} a ${pct(e.ciRet[1])}</span></div>
        <div style="display:grid;gap:4px"><h2>${def.title}</h2><p>${def.desc}${outB}</p></div>
      </div>
      <div class="tiles">
        ${tile('Riesgo σ anual', pct(e.vol), 'año típico: ' + pct(e.range68[0], 0) + ' a ' + pct(e.range68[1], 0))}
        ${tile('Razón de Sharpe', num(e.sharpe), 'mercado: ' + num(m.mktSharpe))}
        ${tile('Razón de Treynor', pct(e.treynor), 'mercado: ' + pct(m.Em - m.rf))}
        ${tile('α de Jensen', pct(e.jensen, 2), 'histórico: ' + pct(e.histAlpha, 2) + ' (t = ' + f1(e.tAlpha) + ')')}
        ${tile('Beta β', num(e.beta), 'R² con el mercado: ' + num(e.r2))}
        ${tile('M² de Modigliani', pct(e.m2), 'al riesgo del mercado')}
        ${tile('N efectivo', num(e.effN, 1), e.nHeld + ' de ' + m.names.length + ' activos')}
        ${tile('Razón de diversificación', num(e.divRatio), 'Σwσ / σp')}
        ${tile('VaR 95 % anual', pct(e.var95), 'pérdida que se supera 1 año de cada 20')}
      </div>
      <div class="port-body">
        <div style="display:grid;gap:8px;min-width:0">
          <h2>Composición</h2>
          <div class="legend"><span><i class="sq" style="background:var(--s1)"></i>Peso</span><span><i class="sq" style="background:var(--s2)"></i>Contribución al riesgo</span></div>
          <div class="chart-box" id="chart-weights"></div>
        </div>
        <div class="money">
          <h2>Tu inversión</h2>
          <p class="meta">Capital: ${money(cap)}</p>
          <p>Ganancia esperada en un año<br><span class="big">${money(cap * e.ret)}</span></p>
          <p class="meta">En dos de cada tres años el resultado debería caer entre ${money(cap * e.range68[0])} y ${money(cap * e.range68[1])}.</p>
          <div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th class="n">Peso</th><th class="n">Monto</th></tr></thead><tbody>
            ${held.map((x) => `<tr><td>${esc(x.n)}</td><td class="n">${pct(x.w)}</td><td class="n">${money(cap * x.w)}</td></tr>`).join('')}
          </tbody></table></div>
        </div>
      </div>`;
  }

  function compareRow(label, e, hl) {
    return `<tr${hl ? ' class="hl"' : ''}><td>${esc(label)}</td><td class="n">${pct(e.ret)}</td><td class="n">${pct(e.vol)}</td><td class="n">${num(e.sharpe)}</td><td class="n">${pct(e.treynor)}</td><td class="n ${e.jensen >= 0 ? 'pos' : 'neg'}">${pct(e.jensen, 2)}</td><td class="n">${num(e.beta)}</td><td class="n">${e.effN == null ? '—' : num(e.effN, 1)}</td><td class="n">${e.divRatio == null ? '—' : num(e.divRatio)}</td></tr>`;
  }
  const HEAD = '<thead><tr><th>Portafolio</th><th class="n">E(R)</th><th class="n">σ</th><th class="n">Sharpe</th><th class="n">Treynor</th><th class="n">α Jensen</th><th class="n">β</th><th class="n">N efectivo</th><th class="n">Diversif.</th></tr></thead>';

  function renderCompare() {
    const m = st.model;
    const mk = { ret: m.Em, vol: m.mktVol, sharpe: m.mktSharpe, treynor: m.Em - m.rf, jensen: 0, beta: 1, effN: null, divRatio: null };
    $('compare-table').innerHTML = HEAD + '<tbody>' + PORTS.filter((p) => st.P[p.key]).map((p) => compareRow(p.label, st.P[p.key], p.key === st.sel)).join('') + compareRow(m.marketName + ' (mercado)', mk) + '</tbody>';
  }

  function renderTB() {
    const m = st.model;
    const tb = PF.model.treynorBlack(m);
    let h = '<h2>Modelo de Treynor-Black: índice + portafolio activo</h2>';
    if (!tb.ok) {
      h += `<p class="hint">${esc(tb.reason)} Con rendimientos esperados del CAPM todos los alfas valen cero y lo óptimo es el índice.</p>`;
      $('tb').innerHTML = h;
      return;
    }
    const rows = m.names
      .map((n, i) => ({ n, w: tb.assetW[i], ar: tb.appraisal[i], t: m.assets[i].tAlpha }))
      .sort((a, b) => b.w - a.w)
      .map((r) => `<tr><td>${esc(r.n)}</td><td class="n ${r.w >= 0 ? '' : 'neg'}">${pct(r.w)}</td><td class="n">${num(r.ar)}</td><td class="n">${f1(r.t)}</td></tr>`)
      .join('');
    h += `<p class="hint">${tb.wIndex >= 0 ? `Invierte ${pct(tb.wIndex)} en el índice (${esc(m.marketName)})` : `Vende en corto ${pct(-tb.wIndex)} del índice (${esc(m.marketName)})`} y pon ${pct(tb.wActive)} en un portafolio activo ponderado por α / σ²(ε). La razón de Sharpe pasaría de ${num(tb.sharpeMkt)} a ${num(tb.sharpeP)}. ${tb.significant ? `Solo ${tb.significant} de ${m.names.length} alfas son estadísticamente significativos (|t| ≥ 2).` : 'Ningún alfa es estadísticamente significativo (|t| ≥ 2), así que esta mejora es sobre todo ruido de muestra.'}${tb.shorts ? ' Los pesos negativos son ventas en corto.' : ''}</p>
      <div class="table-scroll"><table class="data"><thead><tr><th>Posición</th><th class="n">Peso</th><th class="n">Razón de valoración α/σ(ε)</th><th class="n">t (α)</th></tr></thead><tbody>
      <tr class="hl"><td>${esc(m.marketName)} (índice)</td><td class="n">${pct(tb.wIndex)}</td><td class="n">—</td><td class="n">—</td></tr>${rows}</tbody></table></div>`;
    $('tb').innerHTML = h;
  }

  /* ---------- Confirmación ---------- */
  function renderWeightInputs() {
    $('weights').innerHTML = st.userNames
      .map((n, i) => `<div class="wrow"><label for="w-${i}" title="${esc(n)}">${esc(n)}</label><input id="w-${i}" data-w="${i}" type="number" step="0.5" inputmode="decimal" value="${+(st.userW[i] * 100).toFixed(2)}"></div>`)
      .join('');
  }
  function setUserW(w) {
    st.userW = w.slice();
    store.set('userW', { names: st.userNames, w: st.userW });
    renderWeightInputs();
    renderConfirm();
    renderCharts();
  }

  function renderConfirm() {
    const m = st.model;
    const sum = st.userW.reduce((a, b) => a + b, 0);
    const sumEl = $('w-sum');
    sumEl.textContent = `Suma: ${nf1(sum * 100)} %`;
    sumEl.className = 'sum' + (Math.abs(sum - 1) > 0.0005 ? ' bad' : '');
    if (!(sum > 0)) {
      $('verdict').innerHTML = '<p>Escribe al menos un peso positivo.</p>';
      $('checks').innerHTML = '';
      $('confirm-table').innerHTML = '';
      st.conf = null;
      return;
    }
    const w = st.userW.map((x) => x / sum);
    const tol = (val('tol') ?? 0.1) / 100;
    const c = PF.model.confirm(m, w, st.s.wmin, st.s.wmax, tol);
    st.conf = c;
    const e = c.me;
    const V = {
      eficiente: ['good', 'Eficiente', `Ningún portafolio con el mismo riesgo rinde más de ${pct(tol, 2)} adicional al año. Tu portafolio está sobre la frontera eficiente de Markowitz.`],
      casi: ['warn', 'Casi eficiente', `Con el mismo riesgo podrías obtener ${pct(c.retGap, 2)} más al año, o el mismo rendimiento con ${pct(c.volGap, 2)} menos de volatilidad. La diferencia es pequeña frente al error de estimación.`],
      ineficiente: ['bad', 'No eficiente', c.belowMinVar ? `Tu rendimiento esperado está por debajo del portafolio de mínima varianza: ese portafolio rinde más con menos riesgo. Con tu mismo riesgo podrías obtener ${pct(c.retGap, 2)} más al año.` : `Con el mismo riesgo podrías obtener ${pct(c.retGap, 2)} más al año, o el mismo rendimiento con ${pct(c.volGap, 2)} menos de volatilidad.`],
    }[c.verdict];
    const relaxed = c.bounds.hi.some((h) => h > st.s.wmax + 1e-9) || c.bounds.lo.some((l) => l < st.s.wmin - 1e-9);
    $('verdict').innerHTML = `<span class="pill ${V[0]}">${ICON[V[0]]}${V[1]}</span>
      <p>${V[2]}</p>
      <div class="tiles">
        ${tile('Rendimiento esperado', pct(e.ret), 'IC 95 %: ' + pct(e.ciRet[0]) + ' a ' + pct(e.ciRet[1]))}
        ${tile('Riesgo σ', pct(e.vol))}
        ${tile('Sharpe', num(e.sharpe), c.tangency ? 'máximo posible: ' + num(c.tangency.sharpe) : '')}
        ${tile('Ganancia esperada', money(st.s.capital * e.ret), 'sobre ' + money(st.s.capital))}
      </div>
      ${Math.abs(sum - 1) > 0.0005 ? `<p class="hint">Tus pesos suman ${nf1(sum * 100)} %; se reescalaron a 100 % para el análisis.</p>` : ''}
      ${relaxed ? '<p class="hint">Tus pesos salen de los límites definidos en Datos; la frontera de comparación amplía esos límites para incluir tu portafolio.</p>' : ''}`;

    // Lista de verificación
    const items = [];
    items.push([V[0], 'Markowitz: eficiencia media-varianza', V[2]]);
    if (c.tangency) {
      const r = e.sharpe / c.tangency.sharpe;
      items.push([r >= 0.95 ? 'good' : r >= 0.8 ? 'warn' : 'bad', `Sharpe: ${num(e.sharpe)} frente a ${num(c.tangency.sharpe)} del portafolio tangente`, `Obtienes ${nf1(Math.max(0, r) * 100)} % de la máxima prima por unidad de riesgo total. El índice de mercado logra ${num(m.mktSharpe)}.`]);
    }
    const tm = m.Em - m.rf;
    items.push([e.treynor >= tm ? 'good' : e.treynor >= 0.8 * tm ? 'warn' : 'bad', `Treynor: ${pct(e.treynor)} frente a ${pct(tm)} del mercado`, e.beta <= 0 ? 'Con β negativo o nulo la razón de Treynor no se interpreta como prima por riesgo sistemático.' : `Prima esperada por cada unidad de β. ${e.treynor >= tm ? 'Supera a la del mercado.' : 'Queda por debajo de la del mercado: un fondo indexado pagaría más por el mismo riesgo sistemático.'}`]);
    items.push([e.jensen > 0 && e.tAlpha >= 2 ? 'good' : e.jensen >= 0 ? 'warn' : 'bad', `Jensen: α esperado ${pct(e.jensen, 2)} al año`, `En la historia el α fue ${pct(e.histAlpha, 2)} con t = ${f1(e.tAlpha)} (p = ${num(e.pAlpha, 2)}). ${Math.abs(e.tAlpha) >= 2 ? 'Es estadísticamente significativo.' : 'No se distingue de cero con estos datos.'}`]);
    const maxW = Math.max(...w);
    items.push([e.effN >= 5 && maxW <= 0.35 ? 'good' : e.effN >= 3 ? 'warn' : 'bad', `Diversificación: ${num(e.effN, 1)} activos efectivos, peso máximo ${pct(maxW)}`, `Razón de diversificación ${num(e.divRatio)}: combinar los activos elimina ${pct(1 - 1 / e.divRatio)} del riesgo que tendrían por separado.`]);
    $('checks').innerHTML = items.map(([k, t, d]) => `<li>${ICON[k].replace('<svg', `<svg class="${k}"`)}<div><b>${t}</b><p>${d}</p></div></li>`).join('');

    $('confirm-table').innerHTML = HEAD + '<tbody>' + compareRow('Tu portafolio', e, true) + compareRow('Eficiente con tu mismo riesgo', c.sameRisk) + compareRow('Eficiente con tu mismo rendimiento', c.sameRet) + (c.tangency ? compareRow('Tangente (máx. Sharpe)', c.tangency) : '') + '</tbody>';
  }

  /* ---------- Gráficos (solo los visibles: necesitan el ancho real) ---------- */
  function width(id) {
    const el = $(id);
    return el && el.clientWidth ? el.clientWidth : 0;
  }

  function renderCharts() {
    if (!st.model) return;
    const m = st.model;
    const P = st.P;
    const assets = m.assets.map((a) => ({ name: a.name, short: short(a.name, 16), vol: a.vol, ret: a.expRet, beta: a.beta, tip: assetTip(a) }));
    if (st.screen === 'frontera' && width('chart-front')) {
      const ports = PORTS.filter((p) => P[p.key]).map((p) => ({ label: p.short, vol: P[p.key].vol, ret: P[p.key].ret, sel: p.key === st.sel, shape: p.shape, tip: portTip(p.title, P[p.key]) }));
      ports.sort((a, b) => a.sel - b.sel);
      $('chart-front').innerHTML = C.riskReturn({ width: width('chart-front'), front: P.frontier, rf: m.rf, tangent: P.tangency, assets, ports: ports.reverse() });
      $('legend-front').innerHTML = `<span><i class="line" style="background:var(--s1)"></i>Frontera eficiente</span><span><i class="line" style="background:var(--s2)"></i>Línea del mercado de capitales (desde rf)</span><span><i class="dot" style="background:var(--asset)"></i>Activos</span><span><i class="dot" style="background:var(--ink)"></i>Portafolios de referencia</span><span><i class="dot" style="background:var(--s1)"></i>Seleccionado</span>`;
      const e = P[st.sel];
      const rows = m.names.map((n, i) => ({ name: n, w: e.w[i], rc: e.riskContrib[i], tip: `<b>${esc(n)}</b><br>Peso <span class="num">${pct(e.w[i])}</span><br>Contribución al riesgo <span class="num">${pct(e.riskContrib[i])}</span><br>Monto <span class="num">${esc(money(st.s.capital * e.w[i]))}</span>` }));
      rows.sort((a, b) => b.w - a.w);
      if (width('chart-weights')) $('chart-weights').innerHTML = C.weights({ width: width('chart-weights'), rows });
    }
    if (st.screen === 'activos' && width('chart-sml')) {
      $('chart-sml').innerHTML = C.sml({ width: width('chart-sml'), assets, rf: m.rf, Em: m.Em, marketName: m.marketName });
      $('chart-corr').innerHTML = C.corr({ width: width('chart-corr'), names: m.names, corr: m.corr });
    }
    if (st.screen === 'confirmar' && st.conf && width('chart-confirm')) {
      const c = st.conf;
      const guides = [
        { vol: c.sameRisk.vol, ret: c.sameRisk.ret, tip: portTip('Eficiente con tu mismo riesgo', c.sameRisk) },
        { vol: c.sameRet.vol, ret: c.sameRet.ret, tip: portTip('Eficiente con tu mismo rendimiento', c.sameRet) },
      ];
      $('chart-confirm').innerHTML = C.riskReturn({
        width: width('chart-confirm'),
        front: c.front,
        rf: m.rf,
        tangent: c.tangency,
        assets,
        labelAssets: false,
        ports: c.tangency ? [{ label: 'Tangente', vol: c.tangency.vol, ret: c.tangency.ret, tip: portTip('Tangente (máx. Sharpe)', c.tangency) }] : [],
        user: { vol: c.me.vol, ret: c.me.ret, tip: portTip('Tu portafolio', c.me) },
        guides,
        aria: 'Tu portafolio frente a la frontera eficiente',
      });
      $('legend-confirm').innerHTML = `<span><i class="dot" style="background:var(--s3)"></i>Tu portafolio</span><span><i class="line" style="background:var(--s1)"></i>Frontera eficiente</span><span><i class="line" style="background:var(--s2)"></i>Línea del mercado de capitales</span><span><i class="dot" style="background:var(--ink)"></i>Eficientes con igual riesgo o igual rendimiento</span>`;
    }
  }

  /* ---------- Navegación ---------- */
  function go(screen) {
    if (!document.getElementById('screen-' + screen)) screen = 'frontera';
    st.screen = screen;
    document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== 'screen-' + screen));
    document.querySelectorAll('.tabs button').forEach((b) => (b.getAttribute('data-go') === screen ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    try {
      history.replaceState(null, '', '#' + screen);
    } catch (e) {
      /* marco sin historial */
    }
    renderCharts();
  }

  /* ---------- Tooltip ---------- */
  function initTip() {
    const tip = $('tip');
    let cur = null;
    const move = (ev) => {
      const pad = 14;
      const r = tip.getBoundingClientRect();
      let x = ev.clientX + pad;
      let y = ev.clientY + pad;
      if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
      if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = Math.max(8, y) + 'px';
    };
    const show = (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-tip]');
      if (!t) {
        if (cur) {
          tip.hidden = true;
          cur = null;
        }
        return;
      }
      if (t !== cur) {
        cur = t;
        tip.innerHTML = t.getAttribute('data-tip');
        tip.hidden = false;
      }
      move(ev);
    };
    document.addEventListener('pointermove', show);
    document.addEventListener('pointerdown', show);
    document.addEventListener('scroll', () => {
      tip.hidden = true;
      cur = null;
    }, { passive: true });
  }

  /* ---------- Arranque ---------- */
  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  function init() {
    const saved = store.get('settings');
    if (saved) for (const id of SETTING_IDS) if (saved[id] != null && $(id)) $(id).value = saved[id];
    $('csv').value = store.get('csv') || PF.sample.csv();

    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.getAttribute('data-go'))));
    $('btn-sample').addEventListener('click', () => {
      $('csv').value = PF.sample.csv();
      $('kind').value = 'prices';
      $('freq').value = 'mensual';
      st.userNames = null;
      parse(false);
    });
    $('btn-parse').addEventListener('click', () => {
      st.userNames = null;
      parse(false);
    });
    $('file').addEventListener('change', (ev) => {
      loadFiles(ev.target.files);
      ev.target.value = '';
    });
    const drop = $('drop');
    drop.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (ev) => {
      ev.preventDefault();
      drop.classList.remove('over');
      loadFiles(ev.dataTransfer && ev.dataTransfer.files);
    });
    $('csv').addEventListener('paste', () => setTimeout(() => {
      st.userNames = null;
      parse(false);
    }, 0));
    const recompute = debounce(compute, 250);
    for (const id of ['kind', 'market', 'mumodel', 'covmodel']) $(id).addEventListener('change', compute);
    $('freq').addEventListener('change', () => {
      // Con historiales diarios subidos, se reagrupan a la nueva frecuencia.
      if (st.series && $('csv').value === st.mergedText) mergeLoaded(true);
      else compute();
    });
    $('currency').addEventListener('change', () => {
      store.set('settings', Object.fromEntries(SETTING_IDS.map((id) => [id, $(id).value])));
      if (st.model) render();
    });
    for (const id of ['rf', 'em', 'wmin', 'wmax', 'capital']) $(id).addEventListener('input', recompute);
    $('tol').addEventListener('input', debounce(() => {
      if (!st.model) return;
      store.set('settings', Object.fromEntries(SETTING_IDS.map((id) => [id, $(id).value])));
      renderConfirm();
      renderCharts();
    }, 250));

    $('pick').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-port]');
      if (!b) return;
      st.sel = b.getAttribute('data-port');
      renderPick();
      renderPort();
      renderCompare();
      renderCharts();
    });
    $('assets-table').addEventListener('click', (ev) => {
      const th = ev.target.closest('[data-sort]');
      if (!th) return;
      const k = th.getAttribute('data-sort');
      st.sort = { key: k, dir: st.sort.key === k ? -st.sort.dir : k === 'name' ? 1 : -1 };
      renderAssetsTable();
    });
    $('weights').addEventListener('input', debounce((ev) => {
      const i = ev.target.getAttribute('data-w');
      if (i == null) return;
      const v = parseFloat(String(ev.target.value).replace(',', '.'));
      st.userW[+i] = Number.isFinite(v) ? v / 100 : 0;
      store.set('userW', { names: st.userNames, w: st.userW });
      renderConfirm();
      renderCharts();
    }, 300));
    $('w-rec').addEventListener('click', () => st.model && setUserW(rec().w.map((x) => Math.round(x * 10000) / 10000)));
    $('w-eq').addEventListener('click', () => st.model && setUserW(equalRounded(st.userNames.length)));
    $('w-norm').addEventListener('click', () => {
      const s = st.userW.reduce((a, b) => a + b, 0);
      if (s > 0) setUserW(st.userW.map((x) => Math.round((x / s) * 10000) / 10000));
    });

    let lastW = window.innerWidth;
    window.addEventListener('resize', debounce(() => {
      if (window.innerWidth !== lastW) {
        lastW = window.innerWidth;
        renderCharts();
      }
    }, 150));

    initTip();
    const hash = (location.hash || '').slice(1);
    st.screen = document.getElementById('screen-' + hash) ? hash : 'frontera';
    parse(false);
    go(st.screen);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
