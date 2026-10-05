/* Controlador de la interfaz. */
(function () {
  'use strict';
  const PF = globalThis.PF;
  const C = PF.charts;
  const { esc, pct, num, f1 } = C;
  const $ = (id) => document.getElementById(id);

  const PORTS = [
    { key: 'recommended', label: 'Recomendado', short: 'Recomendado', title: 'Portafolio recomendado: máximo rendimiento diversificado', desc: 'El portafolio eficiente (frontera de Markowitz) con el mayor rendimiento esperado que conserva la diversificación exigida: un número efectivo de activos N = 1 / Σwᵢ² mínimo. No reparte por igual ni aplica un tope fijo por acción: un activo puede pesar más que los demás si eso sube el rendimiento, mientras el conjunto siga diversificado. El nivel de diversificación se elige en Datos.' },
    { key: 'tangency', label: 'Máxima Sharpe', short: 'Tangente', title: 'Portafolio tangente: máxima razón de Sharpe', desc: 'La mayor prima por unidad de riesgo total dentro de tus límites de peso. Es el portafolio riesgoso eficiente de la teoría de Markowitz y Sharpe; para menos riesgo, combínalo con el activo libre de riesgo sobre la línea del mercado de capitales.' },
    { key: 'minVar', label: 'Mínima varianza', short: 'Mín. varianza', title: 'Portafolio de mínima varianza', desc: 'El punto de menor riesgo de la frontera eficiente. No usa los rendimientos esperados, así que es el más robusto al error de estimación de las medias.' },
    { key: 'maxDiv', label: 'Máxima diversificación', short: 'Máx. diversif.', shape: 'diamond', title: 'Portafolio de máxima diversificación', desc: 'Maximiza la razón de diversificación Σwσ / σp: el mayor beneficio de combinar activos poco correlacionados.' },
    { key: 'riskParity', label: 'Paridad de riesgo', short: 'Paridad', shape: 'diamond', title: 'Portafolio de paridad de riesgo', desc: 'Cada activo aporta la misma parte del riesgo total. No aplica tus límites de peso.' },
    { key: 'equal', label: 'Pesos iguales', short: '1/N', shape: 'diamond', title: 'Portafolio de pesos iguales (1/N)', desc: 'La diversificación ingenua: el mismo peso en cada activo. Sirve de referencia; rara vez es eficiente.' },
  ];

  const st = { parsed: null, model: null, P: null, sel: 'recommended', userW: null, userNames: null, sort: { key: null, dir: -1 }, screen: 'datos', err: null, mode: 'pesos', buys: {}, buyTotal: 0 };

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

  /* ---------- Tipos de instrumento, segmentos e índices de referencia ---------- */
  const SEGS = {
    variable: { label: 'Renta variable', cls: ['accion', 'etf'] },
    fija: { label: 'Renta fija', cls: ['tes', 'bono', 'cdt'] },
    derivados: { label: 'Derivados', cls: ['futuro', 'opcion'] },
    divisas: { label: 'Divisas', cls: ['divisa'] },
  };
  const segOf = (cls) => Object.keys(SEGS).find((k) => SEGS[k].cls.includes(cls)) || null;
  const FX_RE = /(trm|usd ?\/? ?cop|cop ?=? ?x|dolar|d[óo]lar)/i;
  // Índice que pide cada grupo de instrumentos, dónde se consigue y cómo se reconoce
  const BENCH = [
    { key: 'variable', label: 'Renta variable: acciones y ETF', need: 'MSCI COLCAP', where: 'bvc.com.co → Índices → MSCI COLCAP → Históricos', cls: ['accion', 'etf'], main: true },
    { key: 'tes', label: 'Renta fija: TES y bonos', need: 'COLTES (CP, LP o UVR, según el plazo)', where: 'bvc.com.co → Índices de renta fija → COLTES', cls: ['tes', 'bono'], re: [/coltes/i] },
    { key: 'cdt', label: 'Renta fija: CDT y mercado monetario', need: 'COLIBR (índice del IBR); si no está, COLTES', where: 'bvc.com.co → Índices → COLIBR', cls: ['cdt'], re: [/colibr|(^|\W)ibr(\W|$)/i, /coltes/i] },
    { key: 'divisas', label: 'Divisas', need: 'TRM (dólar/peso)', where: 'banrep.gov.co → Tasa de cambio TRM → serie histórica; en la app de escritorio se descarga sola', cls: ['divisa'], re: [FX_RE] },
    { key: 'derivados', label: 'Derivados: futuros y opciones', need: 'El índice del subyacente: MSCI COLCAP (futuros de índice y de acciones), COLTES (futuros de TES) o TRM (futuros de dólar)', where: 'Los mismos índices de arriba', cls: ['futuro', 'opcion'] },
  ];
  function clsOf(name) {
    const o = store.get('cls') || {};
    if (o[name]) return o[name];
    const s = st.series && st.series.find((x) => x.name === name);
    return (s && s.cls) || PF.data.classify(name);
  }
  // Nombre del índice de referencia de un activo, entre las columnas cargadas (null: el principal)
  function benchName(name, cls, names, mainName) {
    const find = (res) => {
      for (const re of res) {
        const hit = names.find((x) => x !== mainName && re.test(x) && (clsOf(x) === 'indice' || clsOf(x) === 'divisa'));
        if (hit) return hit;
      }
      return null;
    };
    let rule = BENCH.find((b) => b.cls.includes(cls));
    if (cls === 'futuro' || cls === 'opcion') {
      if (/tes/i.test(name)) rule = BENCH[1];
      else if (FX_RE.test(name)) rule = BENCH[3];
      else return null;
    }
    return rule && rule.re ? find(rule.re) : null;
  }

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
      div: $('div').value,
      capital: val('capital') ?? 0,
      fee: Math.max(0, val('fee') ?? 0),
      feeSell: Math.max(0, val('feesell') ?? 0),
      segs: [...document.querySelectorAll('#segs [data-seg]')].filter((c) => c.checked).map((c) => c.getAttribute('data-seg')),
      retType: $('rettype').value,
      agg: $('agg').value,
      history: $('history').value,
    };
  }
  const FEE_NORMAL = 15000; // comisión de trii por operación, sin promociones
  const SETTING_IDS = ['kind', 'freq', 'rettype', 'agg', 'fill', 'history', 'rf', 'em', 'mumodel', 'covmodel', 'wmin', 'wmax', 'div', 'capital', 'fee', 'feesell', 'currency', 'tol'];

  /* Errores que impiden calcular: arriba, en todas las secciones. */
  function showBanner(msg) {
    const b = $('banner');
    b.hidden = !msg;
    b.textContent = msg || '';
  }
  /* Advertencias sobre los datos (historias cortas, índices faltantes…): no son alarmas en los
   * portafolios ni en los activos, sino una nota en Datos. */
  function showDataNotes(msg) {
    showBanner('');
    $('data-notes').hidden = !msg;
    $('data-notes').textContent = msg ? 'Notas sobre los datos: ' + msg : '';
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

  /* Panel de Datos: índices que pide cada segmento y tipo de cada instrumento cargado. */
  /* Activos elegidos para el portafolio: se guardan los que el usuario dejó por fuera. */
  const skipped = () => new Set(store.get('skip') || []);
  function setPicked(names, on) {
    const sk = skipped();
    for (const nm of names) on ? sk.delete(nm) : sk.add(nm);
    store.set('skip', [...sk]);
    st.userNames = null;
    compute();
  }
  /* Candidatos a invertir: no son el índice principal ni índices, y su segmento está marcado. */
  function candidates(s) {
    const p = st.parsed;
    return p ? p.names.filter((nm, i) => i !== s.market && clsOf(nm) !== 'indice' && s.segs.includes(segOf(clsOf(nm)))) : [];
  }
  function renderPicker(s) {
    const box = $('pick-assets');
    if (!box) return;
    const all = candidates(s);
    const sk = skipped();
    const on = all.filter((nm) => !sk.has(nm)).length;
    box.innerHTML = all.length
      ? `<p class="meta">${on} de ${all.length} activos en el portafolio.</p>
        <div class="row-btns"><button type="button" class="btn btn-ghost" data-pick-all="1">Todos</button><button type="button" class="btn btn-ghost" data-pick-all="0">Ninguno</button></div>
        <div class="pick-grid">${all.map((nm) => `<label class="check"><input type="checkbox" data-pick="${esc(nm)}"${sk.has(nm) ? '' : ' checked'}> ${esc(nm)} <span class="sub">${esc(PF.data.CLASSES[clsOf(nm)] || '')}</span></label>`).join('')}</div>`
      : '<p class="meta">Carga datos en la sección Datos.</p>';
  }

  function renderBenchPanel(s) {
    const p = st.parsed;
    if (!p) return;
    const mainName = p.names[s.market];
    const has = (cls) => p.names.some((nm, i) => i !== s.market && cls.includes(clsOf(nm)));
    $('bench-table').innerHTML = '<thead><tr><th>Segmento</th><th>Índice requerido</th><th>Dónde descargarlo</th><th>Estado</th></tr></thead><tbody>' +
      BENCH.map((b) => {
        let state;
        if (b.main) state = PF.data.isMarketName(mainName) ? `<span class="pos">✓ ${esc(mainName)}</span>` : `<span class="neg">✗ Falta (se usa ${esc(mainName)})</span>`;
        else if (!b.re) state = has(b.cls) ? 'Según el subyacente de cada contrato' : '<span class="sub">No hay instrumentos de este tipo</span>';
        else {
          const hit = p.names.find((x) => x !== mainName && b.re.some((re) => re.test(x)) && ['indice', 'divisa'].includes(clsOf(x)));
          state = hit ? `<span class="pos">✓ ${esc(hit)}</span>` : has(b.cls) ? `<span class="neg">✗ Falta (se usa ${esc(mainName)})</span>` : '<span class="sub">No hace falta todavía: no hay instrumentos de este tipo</span>';
        }
        return `<tr><td>${esc(b.label)}</td><td>${esc(b.need)}</td><td>${esc(b.where)}</td><td>${state}</td></tr>`;
      }).join('') + '</tbody>';
    // COLIBR: rendimiento del último año, la mejor referencia de tasa libre de riesgo en pesos
    const ibr = p.names.find((x) => /colibr/i.test(x));
    const note = $('colibr-note');
    st.colibr = null;
    if (ibr) {
      const ser = priceSeries(ibr);
      const last = ser.dates.length - 1;
      if (last > 0) {
        const t1 = Date.parse(ser.dates[last].length === 7 ? ser.dates[last] + '-01' : ser.dates[last]);
        let k = last;
        while (k > 0 && t1 - Date.parse(ser.dates[k - 1].length === 7 ? ser.dates[k - 1] + '-01' : ser.dates[k - 1]) <= 366 * 864e5) k--;
        const days = (t1 - Date.parse(ser.dates[k].length === 7 ? ser.dates[k] + '-01' : ser.dates[k])) / 864e5;
        if (days > 20) st.colibr = Math.pow(ser.prices[last] / ser.prices[k], 365 / days) - 1;
      }
    }
    note.hidden = st.colibr == null;
    if (st.colibr != null) note.innerHTML = `<b>${esc(ibr)}</b> rindió <b>${pct(st.colibr)}</b> efectivo anual en el último año: es la referencia del mercado monetario en pesos. <button type="button" class="btn" id="use-colibr">Usarla como tasa libre de riesgo y en la renta fija segura del plan</button>`;
    const C = PF.data.CLASSES;
    $('inst-table').innerHTML = '<thead><tr><th>Instrumento</th><th>Tipo</th><th>Segmento</th><th>Índice de referencia</th><th>¿Se invierte?</th></tr></thead><tbody>' +
      p.names.map((nm, i) => {
        const cls = clsOf(nm);
        const seg = segOf(cls);
        const opts = Object.keys(C).map((k) => `<option value="${k}"${k === cls ? ' selected' : ''}>${C[k]}</option>`).join('');
        const b = i === s.market || cls === 'indice' ? '—' : benchName(nm, cls, p.names, mainName) || mainName;
        const why = i === s.market ? 'No: índice principal' : cls === 'indice' ? 'No: es un índice' : !s.segs.includes(seg) ? `No: ${SEGS[seg].label.toLowerCase()} desmarcada` : `<label class="check"><input type="checkbox" data-pick="${esc(nm)}"${skipped().has(nm) ? '' : ' checked'} aria-label="Incluir ${esc(nm)} en el portafolio"> En el portafolio</label>`;
        return `<tr><td>${esc(nm)}</td><td><select data-cls="${esc(nm)}" aria-label="Tipo de ${esc(nm)}">${opts}</select></td><td>${seg ? SEGS[seg].label : 'Referencia'}</td><td>${esc(b)}</td><td>${why}</td></tr>`;
      }).join('') + '</tbody>';
  }

  function compute() {
    if (!st.parsed) return;
    const s = settings();
    renderBenchPanel(s);
    renderPicker(s);
    store.set('settings', Object.fromEntries(SETTING_IDS.map((id) => [id, $(id).value])));
    const p = st.parsed;
    const warnings = [];
    try {
      // Tabla pegada o subida ya armada: los huecos también se completan con el último precio
      const vals = s.kind === 'prices' && $('fill').value !== 'no' ? p.values.map((c) => { let last = NaN; return c.map((v) => (Number.isFinite(v) ? (last = v) : last)); }) : p.values;
      st.table = vals === p.values ? p : Object.assign({}, p, { values: vals });
      const R = PF.data.toReturns(vals, s.kind, s.retType === 'log');
      const mi = s.market;
      // Activos invertibles: los de los segmentos elegidos; los índices solo son referencia
      const clsAll = p.names.map(clsOf);
      const sk = skipped();
      const inv = p.names.map((nm, i) => i !== mi && clsAll[i] !== 'indice' && s.segs.includes(segOf(clsAll[i])) && !sk.has(nm));
      const names = p.names.filter((_, i) => inv[i]);
      const n = names.length;
      if (!s.segs.length) throw new Error('Elige al menos un segmento en «Invertir en» (renta variable, renta fija, derivados o divisas).');
      if (n < 2) throw new Error(`Con los segmentos y activos elegidos quedan ${n} ${n === 1 ? 'activo' : 'activos'} para invertir; se necesitan al menos dos. Marca más activos en «Activos del portafolio» (Portafolio o Datos), más segmentos o sube más archivos.`);
      const bench = names.map((nm) => {
        const b = benchName(nm, clsOf(nm), p.names, p.names[mi]);
        const bi = b ? p.names.indexOf(b) : -1;
        return bi >= 0 ? { name: b, returns: R[bi] } : null;
      });
      if (s.wmax * n < 1 - 1e-9) {
        warnings.push(`Con ${n} activos un peso máximo de ${nf1(s.wmax * 100)} % no alcanza para sumar 100 %; se usa ${nf1(100 / n)} %, que obliga a pesos iguales. Sube el peso máximo o agrega activos.`);
        s.wmax = 1 / n;
      }
      else if (s.wmax * n < 1 + 1e-6 && s.wmin <= 0) {
        warnings.push(`Con ${n} activos y un peso máximo de ${nf1(s.wmax * 100)} %, todos los portafolios quedan en pesos iguales (1/N) y la frontera se reduce a un punto. Sube el peso máximo en Datos (por ejemplo a ${nf1(Math.min(100, Math.ceil((150 / n) / 5) * 5))} %) o agrega más acciones.`);
      }
      if (s.wmin * n > 1 + 1e-9) throw new Error(`Con ${n} activos el peso mínimo no puede pasar de ${nf1(100 / n)} %.`);
      if (s.wmin > s.wmax) throw new Error('El peso mínimo es mayor que el máximo.');
      const datos = { names, returns: R.filter((_, i) => inv[i]), market: R[mi], marketName: p.names[mi], dates: p.dates, bench };
      const m = PF.model.build(datos, { freq: s.freq, rf: s.rf, muModel: s.muModel, covModel: s.covModel, marketReturn: s.marketReturn, history: s.history });
      m.assets.forEach((a) => (a.cls = clsOf(a.name)));
      const missing = BENCH.filter((b) => b.re && names.some((nm) => b.cls.includes(clsOf(nm)) && !benchName(nm, clsOf(nm), p.names, p.names[mi])));
      if (missing.length) warnings.push(`Faltan índices de referencia: ${missing.map((b) => `${b.need} para ${b.label.toLowerCase()}`).join('; ')}. Mientras tanto esos activos se miden contra ${p.names[mi]}. Mira «Índices de referencia» en Datos.`);
      if (names.some((nm) => ['futuro', 'opcion'].includes(clsOf(nm)))) warnings.push('Futuros y opciones: la app usa su precio de cierre o de liquidación como si fuera un activo al contado. No modela apalancamiento, garantías ni vencimientos; úsalos con cuidado.');
      if (!PF.data.isMarketName(p.names[mi])) warnings.push(`No se encontró un índice de mercado (COLCAP o ICOLCAP) entre los datos; se está usando «${p.names[mi]}» como mercado, así que las β, Treynor y Jensen no son las del mercado. Sube también el histórico del índice MSCI COLCAP o del ETF ICOLCAP, o elige el índice en «Índice de mercado».`);
      if (st.lagNote && st.series && $('csv').value === st.mergedText) warnings.push(st.lagNote);
      const inf = m.info;
      if (m.singular) warnings.push('Hay menos periodos comunes que activos: la covarianza muestral es singular. Elige «Toda la historia de cada activo» o el modelo de índice único de Sharpe.');
      else if (inf.pairwise) {
        const short = names.map((nm, i) => [nm, inf.counts[i]]).filter((x) => x[1] < 0.8 * Math.max(...inf.counts));
        if (short.length) warnings.push(`Historias de distinta longitud: ${short.map((x) => `${x[0]} (${x[1]} periodos)`).join(', ')} frente a ${Math.max(...inf.counts)} del activo más largo. Cada activo usa toda su historia y cada correlación, las fechas que comparten los dos.${inf.psdFixed ? ' La matriz de correlación se ajustó para que fuera válida.' : ''}`);
        if (m.Teff < 36) warnings.push(`La mayoría de los activos tiene ${m.Teff} periodos; con menos de 36 las estimaciones son inestables.`);
      } else if (m.T < 36) warnings.push(`Solo hay ${m.T} periodos en que todos los activos tienen dato. Con menos de 36 las estimaciones son muy inestables.`);
      const P = PF.model.portfolios(m, s.wmin, s.wmax, { div: s.div });
      warnings.push(...P.warnings);
      st.model = m;
      st.P = P;
      st.s = s;
      if (!P[st.sel]) st.sel = 'recommended';
      const same = st.userNames && st.userNames.join('|') === names.join('|');
      if (!same) {
        const saved = store.get('userW');
        st.userW = saved && saved.names.join('|') === names.join('|') ? saved.w : equalRounded(n);
        st.userNames = names;
        renderWeightInputs();
        renderBuyInputs();
      }
      showDataNotes(warnings.join(' '));
      const dv = P.recommended.div;
      const userCap = s.wmax;
      s.userCap = userCap;
      s.wmax = P.cap; // tope efectivo: lo usan la frontera, la confirmación y el plan de compra
      $('div-hint').textContent = `Recomendado: el mayor rendimiento sobre la frontera eficiente con un N efectivo de al menos ${nf1(dv.target)} de ${n} activos (diversificación ${dv.level}). ` +
        (P.cap >= 1 - 1e-9 ? 'No hizo falta ningún tope por activo: el optimizador reparte libremente.' : `Tope por activo usado: ${nf1(P.cap * 100)} %${P.cap < userCap - 1e-9 ? `, el más holgado con el que la frontera alcanza esa diversificación (tu límite es ${nf1(userCap * 100)} %)` : ' (tu límite)'}.`);
      render();
    } catch (e) {
      st.model = null;
      showBanner(e.message);
      renderEmpty();
    }
  }
  const nf2 = (x) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
  const nf1 = (x) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(x);
  function equalRounded(n) {
    const w = new Array(n).fill(Math.floor(1000 / n) / 1000);
    w[0] += 1 - w.reduce((a, b) => a + b, 0);
    return w.map((x) => Math.round(x * 1e6) / 1e6);
  }

  /* Archivos subidos: una tabla ya armada, o historiales por activo
   * (BVC en Excel o CSV, Investing.com, Yahoo Finance). */
  function status(msg, kind) {
    const el = $('upload-status');
    el.hidden = !msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
    el.textContent = msg || '';
  }

  function readBuffer(f) {
    if (f.arrayBuffer) return f.arrayBuffer();
    return new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => ko(new Error(`No se pudo leer «${f.name}».`));
      r.readAsArrayBuffer(f);
    });
  }

  // UTF-8 si el archivo lo es; si no, Windows-1252 (Excel en español guarda así los CSV).
  function decodeText(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(buf);
    }
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
        sc.onload = () => (globalThis.XLSX ? ok(globalThis.XLSX) : ko(new Error('El lector de Excel no se inicializó.')));
        sc.onerror = () => {
          sheetjs = null;
          ko(new Error('No se pudo cargar el lector de Excel (se necesita internet). Guarda el archivo como CSV desde Excel y súbelo de nuevo.'));
        };
        document.head.appendChild(sc);
      });
    }
    return sheetjs;
  }

  /* Tipo real del archivo por sus primeros bytes: el nombre puede engañar
   * (hay sitios que exportan una tabla HTML con extensión .xls). */
  function sniff(bytes, name) {
    const b = bytes;
    if (b[0] === 0x50 && b[1] === 0x4b) return 'excel'; // xlsx / ods (zip)
    if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'excel'; // xls clásico
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    const head = new TextDecoder('latin1').decode(b.slice(0, 600)).toLowerCase();
    if (/<(html|table|\?xml|workbook)/.test(head)) return 'excel';
    if (/\.(xlsx|xlsm|xls|ods)$/i.test(name) && b.slice(0, 64).some((x) => x === 0)) return 'excel';
    return 'text';
  }

  async function seriesFromFile(f) {
    const buf = await readBuffer(f);
    const bytes = new Uint8Array(buf);
    if (!bytes.length) throw new Error(`«${f.name}» está vacío.`);
    const kind = sniff(bytes, f.name);
    if (kind === 'pdf') throw new Error(`«${f.name}» es un PDF. Descarga el histórico en Excel o CSV.`);
    if (kind === 'excel') {
      const X = await loadSheetJS();
      let wb;
      try {
        wb = X.read(bytes, { type: 'array', cellDates: true });
      } catch (e) {
        throw new Error(`«${f.name}» no se pudo abrir como Excel (${e.message}).`);
      }
      const prices = [];
      const rets = [];
      let lastErr = null;
      for (const name of wb.SheetNames) {
        const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
        try {
          const r = PF.data.readRows(rows, f.name);
          (r.returnsLike ? rets : prices).push(...r.series);
        } catch (e) {
          lastErr = e;
        }
      }
      // Un libro con hojas de precios y de rendimientos: se usan los precios
      if (prices.length) return { series: prices };
      if (rets.length) throw new Error(`«${f.name}» solo tiene rendimientos, no precios. Sube la hoja de precios o los CSV que descarga la BVC.`);
      throw lastErr || new Error(`«${f.name}» no tiene hojas con fechas y precios.`);
    }
    const text = decodeText(buf);
    try {
      const r = PF.data.readText(text, f.name);
      if (!r.returnsLike) return { series: r.series };
    } catch (e) {
      /* sin columna de fecha: se trata como tabla */
    }
    return { table: text, name: f.name };
  }

  async function loadFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    status(`Leyendo ${files.length === 1 ? 'el archivo' : files.length + ' archivos'}…`);
    const results = await Promise.all(
      files.map((f) => seriesFromFile(f).then((r) => r, (e) => ({ error: e.message || String(e), name: f.name })))
    );
    const errors = results.filter((r) => r.error);
    const tables = results.filter((r) => r.table != null);
    const series = results.filter((r) => r.series).flatMap((r) => r.series);
    const errText = errors.map((e) => e.error).join(' ');
    if (tables.length && !series.length && tables.length === 1) {
      st.series = null;
      $('csv').value = tables[0].table;
      st.userNames = null;
      parse(false);
      status(errors.length ? `Se cargó la tabla de «${tables[0].name}». No se pudieron leer: ${errText}` : `Se cargó la tabla de «${tables[0].name}».`, errors.length ? 'warn' : 'ok');
      return;
    }
    if (tables.length) {
      errors.push(...tables.map((t) => ({ error: `«${t.name}» no tiene columnas de fecha y precio de cierre; parece una tabla con un activo por columna, que debe subirse sola.` })));
    }
    const allErr = errors.map((e) => e.error).join(' ');
    if (!series.length) {
      status(allErr || 'No se encontraron datos en los archivos.', 'bad');
      return;
    }
    const combined = PF.data.combineSeries(series);
    // Todo lo leído queda en la biblioteca local; el análisis usa la biblioteca completa
    const saved = await PF.lib.saveSeries(combined, 'archivo');
    await refreshLib();
    const usable = libSeries();
    if (usable.length < 2) {
      status(`Solo hay un instrumento en la biblioteca (${combined[0].name}). Sube también los archivos de tus otras acciones y del índice de mercado (por ejemplo el COLCAP).${allErr ? ' Además: ' + allErr : ''}`, 'bad');
      return;
    }
    st.series = usable;
    const plan = suggestSettings(usable);
    if (mergeLoaded(false)) status(`Listo: ${combined.length} instrumentos leídos de ${files.length - errors.length} archivos y guardados en la biblioteca (${saved.agregadas.toLocaleString('es-CO')} fechas nuevas${saved.nuevas ? `, ${saved.nuevas} instrumentos nuevos` : ''}; los valores ya guardados no cambian). El análisis usa los ${usable.length} instrumentos de la biblioteca. ${plan}${allErr ? ' No se pudieron leer: ' + allErr : ''}`, allErr ? 'warn' : 'ok');
  }

  /* Frecuencia y agregación sugeridas para historiales recién cargados.
   * Diarios bien fechados: semanal con último cierre (más observaciones que mensual y menos
   * sesgo por acciones que no negocian todos los días). Si hay series desfasadas: mensual
   * con promedio del periodo, que amortigua el desfase. */
  function suggestSettings(list) {
    return suggestFreq(list);
  }
  function suggestFreq(list) {
    const dates = [...new Set(list.flatMap((x) => x.dates))].sort();
    const gaps = dates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dates[i])) / 864e5).sort((a, b) => a - b);
    const daily = gaps.length && gaps[Math.floor(gaps.length / 2)] <= 4;
    if (!daily) return '';
    if (PF.data.detectLags(list).length) {
      $('freq').value = 'mensual';
      $('agg').value = 'avg';
      return 'Se detectaron series desfasadas: se usa frecuencia mensual con el promedio de cada mes.';
    }
    $('freq').value = 'semanal';
    $('agg').value = 'last';
    return 'Datos diarios: se usa frecuencia semanal con el último cierre de cada semana. Puedes cambiarla en Supuestos (la diaria usa 242 días hábiles al año).';
  }

  function mergeLoaded(keepMarket) {
    try {
      const freq = $('freq').value;
      const merged = PF.data.mergeSeries(st.series, freq, { agg: $('agg').value, fill: $('fill').value !== 'no' });
      const text = PF.data.toCSV(merged);
      st.mergedText = text;
      const lags = PF.data.detectLags(st.series);
      st.lagNote = lags.length
        ? `Posible desfase de fechas: ${lags.map((l) => `${l.name} se parece más a las demás series corrida ${Math.abs(l.lag)} días ${l.lag < 0 ? 'hacia atrás' : 'hacia adelante'} (correlación ${nf2(l.corr)} frente a ${nf2(l.corr0)} en su fecha)`).join('; ')}. Suele pasar cuando se pegan columnas junto a una sola columna de fechas. Revisa esos datos o usa frecuencia mensual con promedio del periodo, que reduce el efecto.`
        : '';
      const noTrade = st.series.reduce((q, x) => q + (x.noTrade || 0), 0);
      st.mergeNote = `Se unieron ${st.series.length} activos (${st.series.map((x) => `${x.name}: «${x.column}»${x.parts > 1 ? `, ${x.parts} archivos` : ''}, ${x.dates[0]} a ${x.dates[x.dates.length - 1]}`).join('; ')}).` +
        ` ${merged.dates.length} periodos; ${merged.common} con todos los activos.` +
        (merged.holidays.length ? ` Se quitaron ${merged.holidays.length} días en que casi ningún precio cambió (festivos).` : '') +
        (noTrade ? ` ${noTrade} días sin negociación (precio de referencia sin cantidad negociada) no se tomaron como cierre.` : '') +
        (merged.filled.some((x) => x) ? ` Se completaron ${merged.filled.reduce((q, x) => q + x, 0)} ${freq === 'diaria' ? 'días' : 'periodos'} sin negociación con el último precio anterior (${merged.names.map((n, j) => [n, merged.filled[j]]).filter((x) => x[1]).map((x) => `${x[0]}: ${x[1]}`).join(', ')}); cada activo queda completo desde su primera fecha hasta hoy.` : '');
      $('csv').value = text;
      $('kind').value = 'prices';
      st.userNames = null;
      parse(keepMarket);
      return true;
    } catch (e) {
      status(e.message, 'bad');
      showBanner(e.message);
      return false;
    }
  }

  /* Texto pegado en la tabla que en realidad es un historial por activo (formato largo). */
  function pastedSeries() {
    const text = $('csv').value;
    if (text === st.mergedText || !PF.data.isSingleAsset(text)) return false;
    try {
      const combined = PF.data.combineSeries(PF.data.readText(text, 'Activo').series);
      if (combined.length < 2) {
        status('El texto pegado tiene el historial de un solo activo. Pega una tabla con la columna de nemotécnico que incluya todas tus acciones y el índice.', 'bad');
        return true;
      }
      PF.lib.saveSeries(combined, 'texto pegado').then(refreshLib);
      st.series = combined;
      if (mergeLoaded(false)) status(`Listo: ${combined.length} activos leídos del texto pegado y guardados en la biblioteca.`, 'ok');
    } catch (e) {
      status(e.message, 'bad');
    }
    return true;
  }

  /* ---------- Render ---------- */
  function renderEmpty() {
    $('summary').innerHTML = '';
    for (const id of ['assets-table', 'compare-table', 'confirm-table']) $(id).innerHTML = '';
    for (const id of ['chart-sml', 'chart-corr', 'chart-front', 'chart-confirm', 'port', 'tb', 'verdict', 'checks', 'legend-front', 'legend-confirm', 'pick']) $(id).innerHTML = '';
  }

  function rec() {
    return st.P.recommended;
  }

  function render() {
    renderSummary();
    renderAssetsTable();
    renderPick();
    renderPort();
    renderCompare();
    renderTB();
    if (st.mode === 'acciones') computeBuys();
    renderConfirm();
    renderPlan();
    renderScreen(st.screen);
    renderCharts();
  }

  // Secciones que se dibujan solo cuando están a la vista
  const guiaCtx = () => ({ m: st.model, P: st.P, pct, esc, sel: st.sel, ports: PORTS });
  function renderGuia() {
    $('guia').innerHTML = PF.guia.render(guiaCtx());
  }
  const SCREEN_RENDERERS = { guia: () => renderGuia(), estadistica: () => renderPasos(), macro: () => renderMacro(), sistema: () => renderSistema(), biblioteca: () => renderLib() };
  const renderScreen = (screen) => SCREEN_RENDERERS[screen] && SCREEN_RENDERERS[screen]();

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
      ['clsName', 'Tipo', (a) => esc(a.clsName), false],
      ['bench', 'Índice de referencia', (a) => esc(a.bench), false],
    ];
    let rows = m.assets.slice();
    rows.forEach((a) => (a.clsName = PF.data.CLASSES[a.cls] || ''));
    if (st.sort.key) rows.sort((a, b) => (typeof a[st.sort.key] === 'string' ? a[st.sort.key].localeCompare(b[st.sort.key]) : a[st.sort.key] - b[st.sort.key]) * st.sort.dir);
    const head = cols.map(([k, t, , n]) => `<th class="sortable${n ? ' n' : ''}" data-sort="${k}" scope="col"${st.sort.key === k ? ` aria-sort="${st.sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${t}</th>`).join('');
    const body = rows.map((a) => `<tr>${cols.map(([, , f, n, cl]) => `<td class="${n ? 'n' : ''} ${cl ? cl(a) : ''}">${f(a)}</td>`).join('')}</tr>`).join('');
    const mk = `<tr class="hl"><td>${esc(m.marketName)} (mercado)</td><td class="n">${pct(m.Em)}</td><td class="n">${pct(m.mktHist)}</td><td class="n">${pct(m.mktVol)}</td><td class="n">${num(1)}</td><td class="n">${pct(0, 2)}</td><td class="n">—</td><td class="n">${num(m.mktSharpe)}</td><td class="n">${pct(m.Em - m.rf)}</td><td class="n">${num(1)}</td><td>Índice</td><td>—</td></tr>`;
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
        <div style="display:grid;gap:8px;min-width:0;align-content:start">
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

  /* ---------- Compras: acciones y fecha → precio de ese día ---------- */
  const capitalNow = () => (st.mode === 'acciones' && st.buyTotal > 0 ? st.buyTotal : st.s.capital);

  // Historial de precios de un activo: los diarios de los archivos cargados, o la tabla.
  function priceSeries(name) {
    if (st.series && $('csv').value === st.mergedText) {
      const s = st.series.find((x) => x.name === name);
      if (s) return { dates: s.dates, prices: s.prices, daily: true };
    }
    const p = st.parsed;
    const k = p ? p.names.indexOf(name) : -1;
    if (k < 0) return { dates: [], prices: [] };
    const dates = [];
    const prices = [];
    p.dates.forEach((d, t) => {
      const v = p.values[k][t];
      if (Number.isFinite(v)) {
        dates.push(d);
        prices.push(v);
      }
    });
    return { dates, prices, daily: false };
  }

  function renderBuyInputs() {
    if (!st.userNames) return;
    const saved = store.get('buys');
    if (saved && typeof saved === 'object') st.buys = saved;
    if (!$('buy-date').value) {
      const sers = st.userNames.map(priceSeries).filter((x) => x.dates.length);
      const last = sers.map((x) => x.dates.at(-1)).sort()[0];
      if (last && /^\d{4}-\d{2}(-\d{2})?$/.test(last)) $('buy-date').value = last.length === 7 ? last + '-01' : last;
    }
    $('buys').innerHTML = st.userNames
      .map((n, i) => {
        const b = st.buys[n] || {};
        const monto = unitOf(n) === 'monto';
        const defFee = clsOf(n) === 'cdt' ? 0 : st.s ? st.s.fee : FEE_NORMAL;
        return `<div class="brow"><span class="bname">${esc(n)}</span>` +
          `<input id="bq-${i}" data-bq="${i}" type="number" min="0" step="${monto ? 100000 : 1}" inputmode="numeric" placeholder="${monto ? 'Monto ($)' : 'Acciones'}" aria-label="${monto ? 'Monto invertido en' : 'Acciones de'} ${esc(n)}" value="${b.qty != null ? esc(b.qty) : ''}">` +
          `<input id="bd-${i}" data-bd="${i}" type="date" aria-label="Fecha de compra de ${esc(n)}" value="${esc(b.date || $('buy-date').value || '')}">` +
          `<input id="bf-${i}" data-bf="${i}" type="number" min="0" step="1000" inputmode="numeric" class="bfee" placeholder="Comisión: ${esc(String(defFee))}" title="Comisión que pagaste en esta compra (déjala vacía para usar la de Datos; 0 si fue una promoción sin comisión)" aria-label="Comisión de la compra de ${esc(n)}" value="${b.fee != null ? esc(b.fee) : ''}">` +
          `<span class="bnote" id="bn-${i}"></span></div>`;
      })
      .join('');
  }

  function computeBuys() {
    if (!st.userNames) return;
    const rows = st.userNames.map((n, i) => {
      const b = st.buys[n] || {};
      const qty = Math.max(0, parseFloat(String(b.qty ?? '').replace(',', '.')) || 0);
      const date = b.date || $('buy-date').value;
      const ser = priceSeries(n);
      const hit = qty > 0 ? PF.data.priceOn(ser.dates, ser.prices, date) : null;
      const ok = hit && !hit.error;
      const monto = unitOf(n) === 'monto';
      // Por monto (renta fija, divisas, derivados): se compran «unidades» del índice ese día
      const units = ok ? (monto ? qty / hit.price : qty) : 0;
      const amount = ok ? units * hit.price : 0;
      const lastP = ser.prices.at(-1);
      const lastD = ser.dates.at(-1);
      const cdt = clsOf(n) === 'cdt';
      const fb = b.fee != null && String(b.fee).trim() !== '' ? Math.max(0, parseFloat(String(b.fee).replace(',', '.')) || 0) : cdt ? 0 : st.s ? st.s.fee : 0;
      const fs = cdt ? 0 : st.s ? st.s.feeSell : 0;
      return { n, i, qty, monto, units, date, hit, ok, amount, lastP, lastD, value: units * lastP, feeBuy: ok ? fb : 0, feeSell: ok ? fs : 0 };
    });
    const total = rows.reduce((q, r) => q + r.amount, 0);
    const value = rows.reduce((q, r) => q + r.value, 0);
    const buyFees = rows.reduce((q, r) => q + r.feeBuy, 0);
    const sellFees = rows.reduce((q, r) => q + r.feeSell, 0);
    const fee = buyFees + sellFees;
    st.buyTotal = total;
    rows.forEach((r) => {
      const el = $('bn-' + r.i);
      if (!el) return;
      el.className = 'bnote' + (r.hit && r.hit.error ? ' bad' : '');
      el.textContent = !r.qty
        ? ''
        : r.hit.error
          ? r.hit.error
          : r.monto
            ? `Valor del ${r.hit.date}${r.hit.exact ? '' : r.hit.after ? ' (último dato disponible)' : ' (ese día no hubo negociación)'}: ${money(r.amount)} invertidos · comisión ${money(r.feeBuy)}`
            : `Cierre del ${r.hit.date}${r.hit.exact ? '' : r.hit.after ? ' (último dato disponible)' : ' (ese día no hubo negociación)'}: ${money(r.hit.price)} × ${r.qty} = ${money(r.amount)} · comisión ${money(r.feeBuy)}`;
    });
    $('buy-sum').textContent = total > 0 ? `Total invertido: ${money(total)}${buyFees ? ` + comisiones de compra ${money(buyFees)} = ${money(total + buyFees)}` : ''}` : '';
    const has = rows.filter((r) => r.ok);
    $('buy-detail').hidden = !has.length;
    if (has.length) {
      const pctc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + pct(x) : '—');
      $('buy-table').innerHTML =
        '<thead><tr><th>Activo</th><th class="n">Cantidad</th><th>Fecha de compra</th><th>Cierre usado</th><th class="n">Precio de compra</th><th class="n">Invertido</th><th class="n">Comisión de compra</th><th class="n">Peso</th><th>Último cierre</th><th class="n">Precio</th><th class="n">Valor hoy</th><th class="n">Ganancia</th></tr></thead><tbody>' +
        has.map((r) => `<tr><td>${esc(r.n)}</td><td class="n">${r.monto ? 'por monto' : r.qty.toLocaleString('es-CO')}</td><td>${esc(r.date)}</td><td>${esc(r.hit.date)}${r.hit.exact ? '' : ' *'}</td><td class="n">${r.monto ? '—' : money(r.hit.price)}</td><td class="n">${money(r.amount)}</td><td class="n">${money(r.feeBuy)}</td><td class="n">${pct(r.amount / total)}</td><td>${esc(r.lastD)}</td><td class="n">${r.monto ? '—' : money(r.lastP)}</td><td class="n">${money(r.value)}</td><td class="n ${r.value >= r.amount ? 'pos' : 'neg'}">${pctc(r.value / r.amount - 1)}</td></tr>`).join('') +
        `<tr class="hl"><td>Total</td><td></td><td></td><td></td><td></td><td class="n">${money(total)}</td><td class="n">${money(buyFees)}</td><td class="n">${pct(1)}</td><td></td><td></td><td class="n">${money(value)}</td><td class="n ${value >= total ? 'pos' : 'neg'}">${pctc(value / total - 1)}</td></tr>` +
        (fee
          ? `<tr class="hl"><td colspan="5"><b>Costo total con comisiones de compra</b></td><td class="n"><b>${money(total + buyFees)}</b></td><td colspan="3"><b>Neto si vendes hoy (menos ${money(sellFees)} de comisiones de venta)</b></td><td></td><td class="n"><b>${money(value - sellFees)}</b></td><td class="n ${value - sellFees >= total + buyFees ? 'pos' : 'neg'}"><b>${pctc((value - sellFees) / (total + buyFees) - 1)}</b></td></tr>`
          : '') +
        '</tbody>';
      const notes = [];
      if (has.some((r) => !r.hit.exact && !r.hit.after)) notes.push('* Ese día no hubo negociación del activo; se usó el último cierre anterior.');
      if (has.some((r) => r.hit.after)) notes.push('Alguna fecha es posterior al último dato cargado; se usó el último cierre disponible.');
      if (has.some((r) => !priceSeries(r.n).daily)) notes.push('Los precios salen de la tabla agrupada por periodo; para el cierre exacto de un día, carga los CSV diarios de la BVC.');
      notes.push(`La ganancia por activo no incluye dividendos ni comisiones; la fila «Neto si vendes hoy» descuenta la comisión que pagaste en cada compra (${money(buyFees)}; puedes cambiarla en cada fila si hubo promoción) y ${money(st.s ? st.s.feeSell : 0)} por cada venta. Los pesos del portafolio salen del monto invertido en cada activo.`);
      $('buy-notes').textContent = notes.join(' ');
    }
    if (total > 0) st.userW = rows.map((r) => r.amount / total);
    else st.userW = rows.map(() => 0);
  }

  function setMode(mode) {
    st.mode = mode;
    store.set('mode', mode);
    $('mode-pesos').setAttribute('aria-selected', String(mode === 'pesos'));
    $('mode-acciones').setAttribute('aria-selected', String(mode === 'acciones'));
    $('box-pesos').hidden = mode !== 'pesos';
    $('box-acciones').hidden = mode !== 'acciones';
    if (!st.model) return;
    if (mode === 'acciones') computeBuys();
    else {
      $('buy-detail').hidden = true;
      const saved = store.get('userW');
      st.userW = saved && saved.names.join('|') === st.userNames.join('|') ? saved.w : equalRounded(st.userNames.length);
      renderWeightInputs();
    }
    renderConfirm();
    renderCharts();
  }

  /* ---------- Plan de compra ---------- */
  function lastPrices() {
    return st.model.names.map((n) => {
      const s = priceSeries(n);
      return { price: s.prices.at(-1), date: s.dates.at(-1) };
    });
  }

  const unitOf = (name) => (['accion', 'etf'].includes(clsOf(name)) ? 'acciones' : 'monto');
  function planOptions() {
    const m = st.model;
    const key = $('plan-base').value;
    const years = +$('plan-horizon').value || 1;
    const loss = $('plan-loss').value;
    const safePct = val('plan-safe');
    const o = {
      feeBuy: st.s.fee,
      feeSell: st.s.feeSell,
      years,
      minAmt: val('plan-min'),
      safeRate: safePct == null ? st.s.rf : safePct / 100,
      maxLoss: loss === '' ? null : +loss,
      units: m.names.map(unitOf),
      noFee: m.names.map((n) => clsOf(n) === 'cdt'),
      cls: m.names.map(clsOf),
      optimizeK: $('plan-optk').checked && (key === 'tangency' || key === 'recommended'),
      hi: st.s.wmax,
    };
    if (key === 'recommended') {
      // Con menos activos se vuelve a buscar el máximo rendimiento eficiente con la misma diversificación
      o.solve = (idx) => {
        const sub = { mu: idx.map((i) => m.mu[i]), Sigma: idx.map((i) => idx.map((j) => m.Sigma[i][j])) };
        return idx.length === 1 ? [1] : PF.model.recommended(sub, new Array(idx.length).fill(Math.max(0, st.s.wmin)), st.s.userCap, st.s.div).w;
      };
    }
    return o;
  }

  function renderPlan() {
    const m = st.model;
    if (!m) return;
    if (document.activeElement !== $('plan-budget')) $('plan-budget').value = st.s.capital;
    if (document.activeElement !== $('plan-fee')) $('plan-fee').value = st.s.fee;
    if (document.activeElement !== $('plan-feesell')) $('plan-feesell').value = st.s.feeSell;
    const key = $('plan-base').value;
    const base = st.P[key] || rec();
    const lp = lastPrices();
    const o = planOptions();
    const res = PF.plan.recommend(m, base.w, lp.map((x) => x.price), st.s.capital, o);
    $('plan-min').placeholder = `automático: ${money(res.minAmt)}`;
    $('plan-hint').textContent = `Monto mínimo automático: el que hace que las comisiones de compra y venta (${money(o.feeBuy + o.feeSell)}) no pasen del 1 % anual del monto invertido en ${o.years} ${o.years === 1 ? 'año' : 'años'}, sin pasar de la mitad del presupuesto. Las acciones y los ETF se compran por acciones enteras; la renta fija, las divisas y los derivados, por monto. Los CDT no pagan comisión de bolsa.`;
    const best = res.best;
    const plan = best.plan;
    st.plan = null;
    if (!plan.rows.length && !plan.safe) {
      $('plan-out').innerHTML = `<h2>Sin plan</h2><p>${esc(plan.error || 'El presupuesto no alcanza con estas comisiones.')}</p>`;
      $('plan-alt').innerHTML = '';
      $('plan-proj').innerHTML = '';
      return;
    }
    plan.rows.forEach((r) => (r.date = lp[m.names.indexOf(r.name)].date));
    const ev = best.ev;
    st.plan = { plan, ev, label: best.label };
    const H = o.years;
    const yrs = (h) => `${h} ${h === 1 ? 'año' : 'años'}`;
    const qty = (r) => (r.unit === 'monto' ? money(r.amount) : `${r.shares.toLocaleString('es-CO')} ${r.shares === 1 ? 'acción' : 'acciones'}`);
    const buys = plan.rows.map((r) => `${qty(r)} de ${esc(r.name)}`);
    if (plan.safe > 0) buys.push(`${money(plan.safe)} en renta fija segura (CDT o TES corto al ${pct(plan.safeRate)} EA)`);
    const changed = best !== res.full && res.full.plan.k !== plan.k;
    const notes = [];
    if (changed && res.full.ev) notes.push(`Con ${money(plan.budget)} y estas comisiones conviene invertir en ${plan.k} ${plan.k === 1 ? 'activo' : 'activos'} en lugar de ${res.full.plan.k}: la razón de Sharpe neta en ${yrs(H)} sube de ${num(res.full.ev.netSharpe)} a ${num(ev.netSharpe)}. Desmarca «Ajustar el número de activos» para ver el plan con todos.`);
    const sh = plan.riskyShare;
    if (sh.dominated) notes.push(`El portafolio rinde menos que la renta fija segura (${pct(plan.safeRate)}), así que con el límite de pérdida elegido todo va a renta fija.`);
    else if (plan.safe > 0) notes.push(`Con un horizonte de ${yrs(H)} y una probabilidad máxima de pérdida de ${pct(o.maxLoss, 0)}, el ${pct(1 - plan.safe / plan.budget, 0)} va al portafolio y el resto a renta fija segura: es la mayor parte en el portafolio que cumple ese límite (separación de Tobin con el criterio de seguridad de Roy). Con un horizonte más largo o más tolerancia a la pérdida, sube la parte en el portafolio.`);
    if (plan.dropped && plan.dropped.length) notes.push(`Quedan fuera: ${esc([...new Set(plan.dropped.map((d) => `${d.name} (${d.why})`))].join(', '))}.`);
    const dates = [...new Set(plan.rows.map((r) => r.date))];
    const C = PF.data.CLASSES;
    $('plan-out').innerHTML = `
      <p class="plan-lead">Invierte así: <b>${buys.join('; ')}</b>. Pagas ${money(plan.buyFees)} de comisiones de compra.</p>
      <div class="tiles">
        ${tile('En el portafolio', money(plan.invested), `${plan.k} ${plan.k === 1 ? 'activo' : 'activos'} · ${pct(plan.invested / plan.budget, 0)} del presupuesto`)}
        ${tile('En renta fija segura', money(plan.safe), plan.safe > 0 ? `al ${pct(plan.safeRate)} EA` : 'no hace falta con este límite de pérdida')}
        ${tile('Comisiones de compra', money(plan.buyFees), `${money(plan.feeBuy)} por activo`)}
        ${tile('Comisiones de venta (al final)', money(plan.sellFees), `${money(plan.feeSell)} por activo`)}
        ${tile('Efectivo sin invertir', money(plan.cash), 'no alcanza para otra acción')}
        ${tile('Rendimiento neto anual esperado', pct(ev.netRet), `en ${yrs(H)}, después de comisiones`)}
        ${tile('Riesgo σ del total', pct(ev.netVol), 'anual')}
        ${tile('Probabilidad de pérdida', pct(ev.lossProb, 0), `al cabo de ${yrs(H)}`)}
        ${tile('Monto mínimo por inversión', money(plan.minAmt), val('plan-min') == null ? 'automático' : 'elegido por ti')}
      </div>
      <div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th>Tipo</th><th class="n">Peso objetivo</th><th class="n">Último precio</th><th>Fecha</th><th class="n">Cantidad</th><th class="n">Monto</th><th class="n">Peso real</th><th class="n">Comisión de compra</th></tr></thead><tbody>
        ${plan.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(C[r.cls] || '')}</td><td class="n">${pct(r.w)}</td><td class="n">${r.unit === 'monto' ? '—' : money(r.price)}</td><td>${esc(r.date || '')}</td><td class="n"><b>${r.unit === 'monto' ? 'por monto' : r.shares.toLocaleString('es-CO')}</b></td><td class="n">${money(r.amount)}</td><td class="n">${pct(r.realW)}</td><td class="n">${money(r.feeBuy)}</td></tr>`).join('')}
        ${plan.safe > 0 ? `<tr><td>Renta fija segura (CDT o TES corto)</td><td>Renta fija</td><td class="n">—</td><td class="n">—</td><td></td><td class="n">por monto</td><td class="n">${money(plan.safe)}</td><td class="n">—</td><td class="n">${money(0)}</td></tr>` : ''}
        <tr class="hl"><td>Total</td><td></td><td></td><td></td><td></td><td></td><td class="n">${money(plan.invested + plan.safe)}</td><td class="n">${plan.invested ? pct(1) : '—'}</td><td class="n">${money(plan.buyFees)}</td></tr>
      </tbody></table></div>
      ${notes.map((t) => `<p class="hint">${t}</p>`).join('')}
      
      <div class="row-btns"><button type="button" class="btn btn-primary" id="plan-register"${plan.rows.length ? '' : ' disabled'}>Registrar esta compra en Confirmar</button> <button type="button" class="btn" data-go-where="1">Dónde y cómo invertir</button></div>`;
    // Proyecciones
    const hs = [...new Set([1, 3, 5, 10, H])].sort((a, b) => a - b);
    const lbl = (h) => (h <= 1 ? 'Corto plazo' : h <= 3 ? 'Mediano plazo' : 'Largo plazo');
    $('plan-proj').innerHTML = '<thead><tr><th>Plazo</th><th class="n">Valor esperado</th><th class="n">Ganancia neta</th><th class="n">Rendimiento neto anual</th><th class="n">Rango del 95 %</th><th class="n">Probabilidad de pérdida</th></tr></thead><tbody>' +
      hs.map((h) => {
        const pj = PF.plan.project(plan, ev.e, plan.safeRate, h);
        return `<tr${h === H ? ' class="hl"' : ''}><td>${lbl(h)}: ${yrs(h)}${h === H ? ' (tu horizonte)' : ''}</td><td class="n">${money(pj.value)}</td><td class="n ${pj.gain >= 0 ? 'pos' : 'neg'}">${money(pj.gain)}</td><td class="n">${pct(pj.annual)}</td><td class="n">${money(Math.max(0, pj.lo))} a ${money(pj.hi)}</td><td class="n">${pct(pj.lossProb, 0)}</td></tr>`;
      }).join('') + '</tbody>';
    if (st.screen === 'invertir') renderWhere();
    const tries = res.tries.filter((t) => t.ev && (t.plan.rows.length || t.plan.safe));
    $('plan-alt-box').hidden = tries.length < 2;
    $('plan-alt').innerHTML =
      '<thead><tr><th>Alternativa</th><th class="n">Activos</th><th>Composición</th><th class="n">En el portafolio</th><th class="n">Renta fija</th><th class="n">Comisiones (compra + venta)</th><th class="n">E(R) bruto</th><th class="n">Neto anual</th><th class="n">Sharpe neto</th></tr></thead><tbody>' +
      tries
        .map((t) => `<tr${t === best ? ' class="hl"' : ''}><td>${esc(t.label)}${t === best ? ' (elegida)' : ''}</td><td class="n">${t.plan.k}</td><td>${esc(t.plan.rows.map((r) => `${r.name} ${pct(r.realW, 0)}`).join(', '))}</td><td class="n">${money(t.plan.invested)}</td><td class="n">${money(t.plan.safe)}</td><td class="n">${money(t.plan.buyFees + t.plan.sellFees)}</td><td class="n">${pct(t.ev.e.ret)}</td><td class="n">${pct(t.ev.netRet)}</td><td class="n">${num(t.ev.netSharpe)}</td></tr>`)
        .join('') +
      '</tbody>';
  }

  function registerPlan() {
    if (!st.plan) return;
    st.buys = {};
    // Datos mensuales («AAAA-MM»): el campo de fecha necesita un día; se usa el 1.
    const day = (d) => (/^\d{4}-\d{2}$/.test(d || '') ? d + '-01' : d);
    for (const r of st.plan.plan.rows) st.buys[r.name] = { qty: String(r.unit === 'monto' ? r.amount : r.shares), date: day(r.date), fee: String(r.feeBuy) };
    store.set('buys', st.buys);
    renderBuyInputs();
    setMode('acciones');
    go('confirmar');
  }

  /* ---------- Descargas ---------- */
  function download(data, name, mime) {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 2000);
  }
  function dlStatus(msg, kind) {
    const el = $('dl-status');
    el.hidden = !msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
    el.textContent = msg || '';
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  const csvNum = (x) => PF.data.excelNum(Number.isFinite(x) ? +x.toPrecision(12) : NaN);
  const csvTxt = (x) => (/[;"\n]/.test(String(x)) ? '"' + String(x).replace(/"/g, '""') + '"' : String(x));
  function csv(rows) {
    return '﻿' + rows.map((r) => r.map((c) => (typeof c === 'number' ? csvNum(c) : csvTxt(c == null ? '' : c))).join(';')).join('\r\n');
  }

  function reportContext() {
    const m = st.model;
    const extra = [];
    if (st.conf && st.userW && st.userW.some((x) => x > 0)) {
      const sum = st.userW.reduce((a, b) => a + b, 0);
      extra.push({ label: st.mode === 'acciones' ? 'Tu portafolio (acciones compradas)' : 'Tu portafolio (pesos escritos)', w: st.userW.map((x) => x / sum) });
    }
    if (st.plan && st.plan.plan.rows.length) extra.push({ label: `Plan de compra (${st.plan.plan.k} activos, pesos reales)`, w: st.plan.ev.w });
    return { m, P: st.P, table: st.table || st.parsed, marketIdx: st.s.market, s: Object.assign({}, st.s, { marketReturnSet: st.s.marketReturn != null }), extra, plan: st.plan && st.plan.plan, generated: stamp() };
  }

  function doDownload(kind) {
    if (kind === 'macro' || kind === 'macrodoc') {
      const data = macroData();
      if (!Object.keys(data).length) return dlStatus('No hay variables macro: actualízalas o impórtalas en la sección Macro.', 'bad');
      if (kind === 'macro') download('\ufeff' + PF.macro.toCSV(data), `variables-macro-${stamp()}.csv`, 'text/csv;charset=utf-8');
      else {
        const d = documents().find((x) => /macro/i.test(x.name));
        download(d.html, `variables-macro-y-mercado-${stamp()}.html`, 'text/html;charset=utf-8');
      }
      return dlStatus('Listo.', 'ok');
    }
    if (!st.model) return dlStatus('Primero carga datos en la sección Datos.', 'bad');
    if (kind === 'pasos') {
      download(documents()[0].html, `paso-a-paso-${stamp()}.html`, 'text/html;charset=utf-8');
      return dlStatus('Documento paso a paso generado.', 'ok');
    }
    const m = st.model;
    try {
      if (kind === 'xlsx') {
        if (st.s.kind !== 'prices') return dlStatus('El libro de Excel necesita precios; en Datos, los datos cargados son rendimientos.', 'bad');
        const rep = PF.report.build(reportContext());
        download(rep.bytes(), `frontera-eficiente-calculos-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return dlStatus(`Libro generado con ${rep.sheets.length} hojas: ${rep.sheets.map((x) => x.name).join(', ')}.`, 'ok');
      }
      let rows;
      let name;
      if (kind === 'cov') {
        rows = [['Covarianza anual'].concat(m.names)].concat(m.names.map((n, i) => [n].concat(m.Sigma[i])));
        name = 'matriz-covarianzas';
      } else if (kind === 'corr') {
        rows = [['Correlación'].concat(m.names)].concat(m.names.map((n, i) => [n].concat(m.corr[i])));
        name = 'matriz-correlacion';
      } else if (kind === 'ret') {
        const p = st.parsed;
        const R = PF.data.toReturns(p.values, st.s.kind, st.s.retType === 'log');
        rows = [['Fecha'].concat(p.names)].concat(p.dates.slice(st.s.kind === 'prices' ? 1 : 0).map((d, t) => [d].concat(R.map((r) => r[t]))));
        name = 'rendimientos';
      } else if (kind === 'stats') {
        rows = [['Activo', 'Periodos', 'E(R) usado', 'R histórico', 'R CAPM', 'σ', 'β', 'R²', 'Alfa histórico', 't (alfa)', 'Alfa de Jensen', 'Sharpe', 'Treynor', 'Varianza residual']].concat(
          m.assets.map((a) => [a.name, a.periods, a.expRet, a.histRet, a.capmRet, a.vol, a.beta, a.r2, a.alphaHist, a.tAlpha, a.jensen, a.sharpe, a.treynor, a.residVar]),
          [[m.marketName + ' (mercado)', m.info.marketCount, m.Em, m.mktHist, m.Em, m.mktVol, 1, 1, 0, '', 0, m.mktSharpe, m.Em - m.rf, 0]]
        );
        name = 'estadisticas';
      } else if (kind === 'ports') {
        const list = PORTS.filter((p) => st.P[p.key]).map((p) => [p.label, st.P[p.key]]);
        const ctx = reportContext();
        for (const x of ctx.extra) list.push([x.label, PF.model.evaluate(m, x.w)]);
        rows = [['Portafolio', 'E(R)', 'σ', 'β', 'Sharpe', 'Treynor', 'Alfa de Jensen', 'M²', 'N efectivo', 'Razón de diversificación'].concat(m.names)].concat(list.map(([l, e]) => [l, e.ret, e.vol, e.beta, e.sharpe, e.treynor, e.jensen, e.m2, e.effN, e.divRatio].concat(e.w)));
        name = 'portafolios';
      } else if (kind === 'plan') {
        if (!st.plan) return dlStatus('No hay plan de compra: revisa la sección Comprar.', 'bad');
        const pl = st.plan.plan;
        rows = [['Activo', 'Tipo', 'Peso objetivo', 'Precio', 'Fecha del precio', 'Acciones', 'Monto', 'Peso real', 'Comisión de compra', 'Comisión de venta']].concat(pl.rows.map((r) => [r.name, PF.data.CLASSES[r.cls] || '', r.w, r.unit === 'monto' ? '' : r.price, r.date || '', r.unit === 'monto' ? '' : r.shares, r.amount, r.realW, r.feeBuy, r.feeSell]), [
          [],
          ['Presupuesto', pl.budget],
          ['Horizonte (años)', pl.years],
          ['En el portafolio', pl.invested],
          ['En renta fija segura', pl.safe],
          ['Tasa de la renta fija segura', pl.safeRate],
          ['Comisiones de compra', pl.buyFees],
          ['Comisiones de venta', pl.sellFees],
          ['Efectivo sin invertir', pl.cash],
          ['Monto mínimo por inversión', pl.minAmt],
          ['Rendimiento esperado del portafolio', st.plan.ev.e.ret],
          ['Rendimiento neto anual en el horizonte', st.plan.ev.netRet],
          ['Probabilidad de pérdida en el horizonte', st.plan.ev.lossProb],
        ]);
        name = 'plan-de-compra';
      }
      download(csv(rows), `${name}-${stamp()}.csv`, 'text/csv;charset=utf-8');
      dlStatus(`Descargado ${name}.csv.`, 'ok');
    } catch (e) {
      dlStatus('No se pudo generar el archivo: ' + e.message, 'bad');
    }
  }

  function renderConfirm() {
    const m = st.model;
    const sum = st.userW.reduce((a, b) => a + b, 0);
    const sumEl = $('w-sum');
    sumEl.textContent = `Suma: ${nf1(sum * 100)} %`;
    sumEl.className = 'sum' + (Math.abs(sum - 1) > 0.0005 ? ' bad' : '');
    if (!(sum > 0)) {
      $('verdict').innerHTML = st.mode === 'acciones' ? '<p>Escribe cuántas acciones compraste de al menos un activo y la fecha de compra.</p>' : '<p>Escribe al menos un peso positivo.</p>';
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
        ${tile('Ganancia esperada', money(capitalNow() * e.ret), (st.mode === 'acciones' ? 'sobre lo invertido: ' : 'sobre ') + money(capitalNow()))}
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

  /* Datos para la terminal y la cinta: los historiales cargados tal como vienen
   * (diarios si se subieron los CSV de la BVC), o la tabla por periodo. */
  function terminalCtx() {
    const p = st.parsed;
    if (!p) return null;
    let list;
    if (st.series && $('csv').value === st.mergedText) list = st.series.map((x) => ({ name: x.name, dates: x.dates, prices: x.prices }));
    else list = p.names.map((n) => Object.assign({ name: n }, priceSeries(n)));
    list = list.filter((x) => x.dates.length >= 2);
    const market = st.model ? st.model.marketName : p.names[PF.data.guessMarket(p.names)];
    // El índice de referencia va primero
    list.sort((a, b) => (a.name === market ? -1 : b.name === market ? 1 : 0));
    const all = [...new Set(list.flatMap((x) => x.dates))].sort();
    const gaps = all.slice(1).map((d, i) => (Date.parse(d) - Date.parse(all[i])) / 864e5).sort((a, b) => a - b);
    const daily = gaps.length > 0 && gaps[Math.floor(gaps.length / 2)] <= 4;
    return { list, market, daily, f: st.model ? st.model.f : 12 };
  }

  function renderCharts() {
    if (st.parsed && PF.terminal) {
      const ctx = terminalCtx();
      PF.terminal.tape(ctx);
      if (st.screen === 'terminal') PF.terminal.render(ctx);
    }
    if (!st.model) return;
    const m = st.model;
    const P = st.P;
    const assets = m.assets.map((a) => ({ name: a.name, short: short(a.name, 16), vol: a.vol, ret: a.expRet, beta: a.betaM, tip: assetTip(a) }));
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
    if (!document.getElementById('screen-' + screen)) screen = 'datos';
    st.screen = screen;
    document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== 'screen-' + screen));
    document.querySelectorAll('.tabs button').forEach((b) => (b.getAttribute('data-go') === screen ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    try {
      history.replaceState(null, '', '#' + screen);
    } catch (e) {
      /* marco sin historial */
    }
    if (screen === 'invertir') renderWhere();
    renderScreen(screen);
    renderCharts();
  }

  function renderWhere() {
    const r = PF.where.render({ plan: st.plan && st.plan.plan, money, pct, segOf, clsOf, SEGS });
    $('where-plan').innerHTML = `<h2>Tu plan, canal por canal</h2>${r.summary}`;
    $('where-cards').innerHTML = r.cards;
    $('where-steps').innerHTML = r.steps;
  }

  /* ---------- Biblioteca local ---------- */
  st.lib = { series: [], macro: {} };
  const libCut = () => store.get('corte') || '';
  async function refreshLib() {
    st.lib = await PF.lib.all();
    if (st.screen === 'biblioteca') renderLib();
  }
  // Series para el análisis: las marcadas «usar», hasta la fecha de corte
  const libSeries = () =>
    PF.data.combineSeries(
      st.lib.series
        .filter((r) => r.use !== false)
        .map((r) => PF.lib.toSeries(r, libCut()))
        .filter((x) => x.dates.length >= 3)
    );
  function useLibrary(msg) {
    const usable = libSeries();
    if (usable.length < 2) return false;
    st.series = usable;
    const ok = mergeLoaded(true);
    if (ok) status(msg || `Análisis con la biblioteca local: ${usable.length} instrumentos${libCut() ? `, datos hasta el ${libCut()}` : ''}.`, 'ok');
    return ok;
  }
  function libStatus(msg, kind) {
    const el = $('lib-status');
    el.hidden = !msg;
    el.className = 'status ' + (kind || '');
    el.textContent = msg || '';
  }
  /* Catálogo de la BVC: qué activos ya están en la biblioteca y cuáles faltan. */
  function renderCatalog() {
    const key = PF.data.assetKey;
    const inLib = new Map(st.lib.series.map((r) => [key(r.name), r]));
    const cat = PF.catalog || [];
    const have = cat.filter((c) => inLib.has(key(c.nemo))).length;
    const desk = !!globalThis.bvc;
    $('cat-summary').textContent = `${have} de ${cat.length} activos del catálogo están en la biblioteca. Los precios salen solo de la BVC: en bvc.com.co busca cada nemotécnico y descarga sus históricos (hasta 6 meses por archivo). ${desk ? '«Abrir la BVC para descargar los que faltan» abre el sitio dentro de la app: cada archivo que descargas se importa solo, los tramos de un mismo activo se unen y quedan en la biblioteca.' : 'Sube los archivos en Datos: los tramos de un mismo activo se unen solos y quedan en la biblioteca.'}`;
    $('cat-download').hidden = !desk;
    $('cat-table').innerHTML = '<thead><tr><th>Nemotécnico</th><th>Emisor o instrumento</th><th>Sector</th><th>En la biblioteca</th><th>Desde</th><th class="n">Días</th></tr></thead><tbody>' +
      cat.map((c) => {
        const r = inLib.get(key(c.nemo));
        return `<tr><td><b>${esc(c.nemo)}</b></td><td>${esc(c.name)}</td><td>${esc(c.sector)}</td><td>${r ? '<span class="cat-ok">✓ Sí</span>' : '<span class="cat-miss">Falta</span>'}</td><td>${r ? esc(r.dates[0]) : '—'}</td><td class="n">${r ? r.dates.length.toLocaleString('es-CO') : '—'}</td></tr>`;
      }).join('') + '</tbody>';
  }

  function renderLib() {
    renderCatalog();
    const L = st.lib;
    const C = PF.data.CLASSES;
    const cut = libCut();
    const n = L.series.reduce((q, r) => q + r.dates.length, 0);
    const last = (a) => a[a.length - 1];
    $('lib-cut').value = cut;
    $('lib-summary').textContent = L.series.length
      ? `${L.series.length} instrumentos y ${Object.keys(L.macro).length} variables macro guardados, con ${n.toLocaleString('es-CO')} datos diarios. ${cut ? `Los cálculos usan los datos hasta el ${cut}.` : 'Los cálculos usan todos los datos guardados.'}`
      : 'La biblioteca está vacía: sube los históricos de la BVC en Datos (o actualiza en Mercado, en la app de escritorio) y quedan guardados aquí.';
    $('lib-table').innerHTML = L.series.length
      ? '<thead><tr><th>Usar</th><th>Instrumento</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th class="n">Datos</th><th>Cantidad y volumen</th><th>Fuente</th><th>Última fecha agregada</th><th></th></tr></thead><tbody>' +
        L.series
          .map((r) => `<tr><td><input type="checkbox" data-lib-use="${esc(r.name)}"${r.use !== false ? ' checked' : ''} aria-label="Usar ${esc(r.name)} en el análisis"></td><td>${esc(r.name)}</td><td>${esc(C[r.cls] || (r.kind === 'tasa' ? 'Renta fija' : ''))}</td><td>${esc(r.dates[0])}</td><td>${esc(last(r.dates))}</td><td class="n">${r.dates.length.toLocaleString('es-CO')}</td><td>${r.qty ? 'Sí' : '—'}</td><td>${esc(r.source)}</td><td>${esc(String(r.updated).slice(0, 10))}</td><td><button type="button" class="btn btn-ghost" data-lib-dl="${esc(r.name)}">Descargar CSV</button> <button type="button" class="btn btn-ghost" data-lib-del="${esc(r.name)}">Quitar</button></td></tr>`)
          .join('') +
        '</tbody>'
      : '';
    const V = PF.macro.VARS;
    const mk = Object.values(L.macro);
    $('lib-macro').innerHTML = mk.length
      ? '<thead><tr><th>Variable</th><th>Desde</th><th>Hasta</th><th class="n">Datos</th><th>Fuente</th><th></th></tr></thead><tbody>' +
        mk.map((m) => `<tr><td>${esc(V[m.key] ? V[m.key].long : m.key)}</td><td>${esc(m.dates[0])}</td><td>${esc(last(m.dates))}</td><td class="n">${m.dates.length.toLocaleString('es-CO')}</td><td>${esc(m.source)}</td><td><button type="button" class="btn btn-ghost" data-lib-delm="${esc(m.key)}">Quitar</button></td></tr>`).join('') +
        '</tbody>'
      : '<tbody><tr><td class="sub">Sin variables macro guardadas: actualízalas o impórtalas en Macro.</td></tr></tbody>';
  }
  /* Series de la app de escritorio → biblioteca, con su fuente (BVC; solo las divisas vienen de la fuente automática). */
  const SRC_LABEL = { BVC: 'BVC', 'BVC + automática': 'BVC + fuente automática (divisas)', 'automática': 'fuente automática (divisas)' };
  async function saveDesktopSeries(series) {
    const out = { nuevas: 0, agregadas: 0 };
    const groups = new Map();
    for (const x of series || []) {
      const src = SRC_LABEL[x.column] || 'app de escritorio';
      if (!groups.has(src)) groups.set(src, []);
      groups.get(src).push(x);
    }
    for (const [src, list] of groups) {
      const r = await PF.lib.saveSeries(list, src);
      out.nuevas += r.nuevas;
      out.agregadas += r.agregadas;
    }
    await refreshLib();
    return out;
  }
  function catStatus(msg, kind) {
    const el = $('cat-status');
    el.hidden = !msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
    el.textContent = msg || '';
  }
  /* Matriz de precios (hoja «M. PRECIOS») con los activos marcados «Usar» de la biblioteca. */
  function priceMatrix(calendar) {
    let list = st.lib.series.filter((r) => r.use !== false && r.kind !== 'tasa');
    // Sin biblioteca (por ejemplo, con los datos de ejemplo o pegados): los datos cargados en Datos
    if (!list.length && st.parsed && st.parsed.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) list = st.parsed.names.map((name, i) => ({ name, dates: st.parsed.dates, prices: st.parsed.values[i] }));
    const mi = PF.data.guessMarket(list.map((r) => r.name));
    const market = list[mi] && PF.data.isMarketName(list[mi].name) ? list[mi].name : null;
    return PF.matriz.workbook(list, { calendar, market, cut: libCut() });
  }
  function wireLib() {
    const box = $('screen-biblioteca');
    $('mx-download').addEventListener('click', () => {
      const el = $('mx-status');
      el.hidden = false;
      const { mx, bytes } = priceMatrix($('mx-cal').value);
      if (!bytes) {
        el.className = 'status bad';
        el.textContent = 'La biblioteca no tiene precios todavía: carga archivos en Datos.';
        return;
      }
      download(bytes, `Matriz de precios ${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const nFill = mx.filled.reduce((q, c) => q + c.filter(Boolean).length, 0);
      el.className = 'status ok';
      el.textContent = `Matriz de ${mx.names.length} activos y ${mx.dates.length.toLocaleString('es-CO')} fechas (${mx.dates[0]} a ${mx.dates[mx.dates.length - 1]}); ${nFill.toLocaleString('es-CO')} celdas completadas con el último precio cotizado.`;
    });
    $('cat-download').addEventListener('click', async () => {
      const api = globalThis.bvc;
      if (!api) return;
      await api.abrirBVC();
      const miss = (PF.catalog || []).filter((c) => c.type !== 'divisa' && !st.lib.series.some((r) => PF.data.assetKey(r.name) === PF.data.assetKey(c.nemo)));
      catStatus(`Se abrió la BVC. Faltan ${miss.length}: ${miss.map((c) => c.nemo).join(', ')}. Busca cada uno, descarga sus históricos y la app los importa solos.`, 'ok');
    });
    box.addEventListener('change', async (ev) => {
      const t = ev.target;
      if (t.dataset.libUse) {
        await PF.lib.setUse(t.dataset.libUse, t.checked);
        await refreshLib();
        useLibrary();
      } else if (t.id === 'lib-cut') {
        store.set('corte', t.value || '');
        renderLib();
        useLibrary();
      } else if (t.id === 'lib-file' && t.files && t.files[0]) {
        try {
          const r = await PF.lib.importJSON(JSON.parse(await t.files[0].text()));
          await refreshLib();
          useLibrary();
          libStatus(`Biblioteca importada: ${r.nuevas} instrumentos nuevos, ${r.agregadas.toLocaleString('es-CO')} fechas y ${r.macro} datos macro agregados. Los valores que ya tenías no cambiaron.`, 'ok');
        } catch (e) {
          libStatus(e.message, 'bad');
        }
        t.value = '';
      }
    });
    box.addEventListener('click', async (ev) => {
      const t = ev.target.closest('button');
      if (!t) return;
      if (t.dataset.libDl) {
        // Un solo archivo con todo el historial del activo, con los valores tal como vienen de la fuente
        const r = st.lib.series.find((x) => x.name === t.dataset.libDl);
        // Todos los días calendario: los días sin negociación llevan el último precio cotizado
        const head = (r.kind === 'tasa' ? 'Fecha;Nemotécnico;Tasa' : 'Fecha;Nemotécnico;Precio cierre') + ';Negociación' + (r.qty && r.kind !== 'tasa' ? ';Cantidad;Volumen' : '');
        const full = PF.matriz.fullHistory({ name: r.name, dates: r.dates, prices: r.prices.map((x) => (x == null ? NaN : x)), qty: r.qty, vol: r.vol });
        const rows = full.map((x) => `${x.date};${r.name};${cell(r.kind === 'tasa' ? x.price * 100 : x.price)};${x.traded ? 'Sí' : 'No (último precio)'}${r.qty && r.kind !== 'tasa' ? `;${cell(x.qty)};${cell(x.vol)}` : ''}`);
        download('\ufeff' + [head].concat(rows).join('\r\n'), `${r.name.replace(/[\\/:*?"<>|]+/g, '-')}.csv`, 'text/csv;charset=utf-8');
        return;
      }
      if (t.dataset.libDel || t.dataset.libDelm) {
        const what = t.dataset.libDel || PF.macro.VARS[t.dataset.libDelm].long;
        if (!confirm(`¿Quitar «${what}» de la biblioteca? Se borra su histórico guardado.`)) return;
        await PF.lib.remove(t.dataset.libDel ? 'series' : 'macro', t.dataset.libDel || t.dataset.libDelm);
        await refreshLib();
        if (t.dataset.libDel) useLibrary();
      } else if (t.id === 'lib-use') {
        if (!useLibrary()) libStatus('Se necesitan al menos dos instrumentos marcados para el análisis.', 'bad');
        else go('frontera');
      } else if (t.id === 'lib-export') {
        download(JSON.stringify(await PF.lib.exportJSON()), `biblioteca-frontera-eficiente-${stamp()}.json`, 'application/json');
      } else if (t.id === 'lib-csv') {
        const rows = ['Instrumento,Tipo,Fecha,Valor,Cantidad,Volumen'];
        for (const r of st.lib.series) r.dates.forEach((d, i) => rows.push(`"${r.name}",${r.kind === 'tasa' ? 'tasa' : r.cls || ''},${d},${r.prices[i]},${r.qty && r.qty[i] != null ? r.qty[i] : ''},${r.vol && r.vol[i] != null ? r.vol[i] : ''}`));
        download('\ufeff' + rows.join('\n'), `biblioteca-historicos-${stamp()}.csv`, 'text/csv;charset=utf-8');
        if (Object.keys(st.lib.macro).length) download('\ufeff' + PF.macro.toCSV(macroData()), `biblioteca-macro-${stamp()}.csv`, 'text/csv;charset=utf-8');
      } else if (t.id === 'lib-clear') {
        if (!confirm('¿Vaciar toda la biblioteca local? Se borran todos los históricos y variables macro guardados en este equipo. Exporta una copia antes si la necesitas.')) return;
        await PF.lib.clear();
        await refreshLib();
        libStatus('Biblioteca vaciada.', 'ok');
      }
    });
  }
  // Al abrir: las variables macro importadas en versiones anteriores pasan a la biblioteca,
  // y si hay datos guardados el análisis arranca con ellos.
  async function startLibrary() {
    const old = store.get('macro');
    if (old && typeof old === 'object') {
      for (const [k, d] of Object.entries(old)) if (d && d.dates) await PF.lib.saveMacro(k, d, d.source);
      store.set('macro', null);
    }
    await refreshLib();
    if (libSeries().length >= 2 && !(st.series && st.series.length)) useLibrary(`Datos cargados desde la biblioteca local: ${libSeries().length} instrumentos${libCut() ? `, hasta el ${libCut()}` : ''}. Para agregar fechas nuevas, sube los archivos en Datos.`);
  }

  /* ---------- Paso a paso y betas de Damodaran ---------- */
  function pasosCtx() {
    const pa = store.get('pa') || {};
    const n = st.model ? st.model.names.length : 0;
    return {
      m: st.model,
      table: st.table || st.parsed,
      kind: st.s.kind,
      retType: st.s.retType,
      P: st.P,
      esc,
      pct,
      num,
      a: pa.a < n ? pa.a : 0,
      b: pa.b < n ? pa.b : Math.min(1, n - 1),
      dam: { list: (store.get('damodaran') || {}).list || null, inputs: store.get('dam') || {} },
      crp: store.get('crp') || 0,
      desktop: !!globalThis.bvc,
      sel: st.sel,
      ports: PORTS,
      user: st.conf && st.conf.me ? st.conf.me : null,
      tb: st.model ? PF.model.treynorBlack(st.model) : null,
      width: Math.min(760, Math.max(320, ($('pasos') && $('pasos').clientWidth - 40) || 640)),
    };
  }
  const pasosHTML = (ctx) => PF.pasos.render(ctx) + PF.frontera.render(ctx);
  function renderPasos() {
    if (!st.model) return;
    try {
      $('pasos').innerHTML = pasosHTML(pasosCtx());
    } catch (e) {
      $('pasos').innerHTML = `<div class="panel"><p>No se pudo armar el desarrollo: ${esc(e.message)}</p></div>`;
    }
  }
  function damStatus(msg, kind) {
    const el = $('dam-status');
    if (!el) return;
    el.hidden = false;
    el.className = 'status ' + (kind || '');
    el.textContent = msg;
  }
  async function loadDamodaran(read, source) {
    try {
      damStatus('Leyendo las betas de Damodaran…');
      const X = await loadSheetJS();
      const wb = read(X);
      let list = null;
      let err = null;
      for (const sh of wb.SheetNames) {
        try {
          list = PF.pasos.parseDamodaran(X.utils.sheet_to_json(wb.Sheets[sh], { header: 1, raw: true }));
          break;
        } catch (e) {
          err = e;
        }
      }
      if (!list) throw err || new Error('El libro no tiene la tabla de Damodaran.');
      store.set('damodaran', { list, source, date: new Date().toISOString().slice(0, 10) });
      renderPasos();
      damStatus(`Industrias de Damodaran cargadas: ${list.length} (${source}). Elige la industria de cada activo y escribe su D/E.`, 'ok');
    } catch (e) {
      damStatus(e.message, 'bad');
    }
  }
  function wirePasos() {
    const box = $('screen-estadistica');
    box.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.id === 'pa-a' || t.id === 'pa-b') {
        const pa = store.get('pa') || {};
        pa[t.id === 'pa-a' ? 'a' : 'b'] = +t.value;
        store.set('pa', pa);
        renderPasos();
      } else if (t.dataset && t.dataset.dam) {
        const all = store.get('dam') || {};
        all[t.dataset.dam] = Object.assign({}, all[t.dataset.dam], { [t.dataset.f]: t.value });
        store.set('dam', all);
        renderPasos();
      } else if (t.id === 'dam-crp') {
        const v = parseFloat(String(t.value).replace(',', '.'));
        store.set('crp', Number.isFinite(v) ? v / 100 : 0);
        renderPasos();
      } else if (t.id === 'dam-file' && t.files && t.files[0]) {
        const file = t.files[0];
        file.arrayBuffer().then((buf) => loadDamodaran((X) => X.read(new Uint8Array(buf), { type: 'array' }), file.name));
      }
    });
    box.addEventListener('click', async (ev) => {
      if (!ev.target.closest('#dam-download') || !globalThis.bvc || !globalThis.bvc.damodaran) return;
      damStatus('Descargando de pages.stern.nyu.edu…');
      try {
        const r = await globalThis.bvc.damodaran();
        await loadDamodaran((X) => X.read(r.base64, { type: 'base64' }), `${r.file}, descargado el ${r.date}`);
      } catch (e) {
        damStatus('No se pudo descargar: ' + e.message + ' Descárgalo a mano desde la página de Damodaran y cárgalo con el botón de al lado.', 'bad');
      }
    });
  }

  /* ---------- Variables macroeconómicas ---------- */
  // Variables macro: las guardadas en la biblioteca, hasta la fecha de corte
  const macroData = () => {
    const cut = libCut();
    const out = {};
    for (const [k, d] of Object.entries((st.lib && st.lib.macro) || {})) {
      const keep = d.dates.map((t) => !cut || t <= cut);
      out[k] = { dates: d.dates.filter((_, i) => keep[i]), values: d.values.filter((_, i) => keep[i]), source: d.source, updated: d.updated };
    }
    return out;
  };
  function macroStatus(msg, kind) {
    const el = $('macro-status');
    el.hidden = !msg;
    el.className = 'status ' + (kind || '');
    el.textContent = msg || '';
  }
  function renderMacro() {
    const data = macroData();
    let market = marketSeries();
    const assets = st.model ? st.model.names.map((n) => Object.assign({ name: n }, priceSeries(n))) : [];
    if (market && !market.dates.length) market = null;
    const w = Math.max(260, Math.min(520, ($('macro-cards').clientWidth || 700) / 2 - 40));
    const r = PF.macro.render({ data, market, assets, esc, width: w, desktop: !!globalThis.bvc });
    $('macro-cards').innerHTML = r.cards;
    $('macro-table').innerHTML = r.table || '<p class="sub">Carga datos de activos y de las variables.</p>';
  }
  function wireMacro() {
    $('macro-file').addEventListener('change', async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const key = $('macro-var').value;
      try {
        const buf = await file.arrayBuffer();
        let text;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch (e) {
          text = new TextDecoder('windows-1252').decode(buf);
        }
        const d = PF.macro.parseFile(text, file.name);
        await PF.lib.saveMacro(key, d, 'Archivo importado: ' + file.name);
        await refreshLib();
        macroStatus(`${PF.macro.VARS[key].long}: ${d.dates.length} datos de ${d.dates[0]} a ${d.dates[d.dates.length - 1]}.`, 'ok');
        renderMacro();
      } catch (e) {
        macroStatus(e.message, 'bad');
      }
      ev.target.value = '';
    });
  }

  const marketSeries = () => (st.model ? Object.assign({ name: st.model.marketName }, priceSeries(st.model.marketName)) : null);
  // Parte fija de la sección (sistema económico y financiero), con las cifras macro vigentes
  function sistemaBaseHTML() {
    const data = macroData();
    const classes = st.model ? st.model.names.map(clsOf) : [];
    return PF.sistema.render({ macro: data, results: PF.macro.relateAll(marketSeries(), data), classes, marketName: st.model && st.model.marketName, esc });
  }
  // Parte de índices: depende de las acciones en circulación y de la ponderación elegidas
  function sistemaIdxHTML() {
    return PF.indices.render({
      series: st.series || [],
      table: st.table || st.parsed,
      model: st.model,
      shares: store.get('shares') || {},
      method: store.get('idxMethod') || 'liq',
      clsOf,
      esc,
      num,
      pct,
      money,
      width: Math.max(320, Math.min(1000, ($('sistema').clientWidth || 800) - 40)),
    });
  }
  function renderSistema() {
    $('sistema').innerHTML = `<div id="sistema-base">${sistemaBaseHTML()}</div><div id="sistema-idx">${sistemaIdxHTML()}</div>`;
  }
  const renderSistemaIdx = () => ($('sistema-idx').innerHTML = sistemaIdxHTML());

  /* Documentos autónomos para la biblioteca local y las descargas. */
  function documents() {
    const docs = [{ name: 'Guia para operar acciones y ETF en la BVC.html', html: PF.pasos.documentHTML('Guía para aprender a operar acciones y ETF en la BVC', PF.guia.render(guiaCtx()).replace(/<button[^>]*data-guia-go[^>]*>[^<]*<\/button>/g, '').replace(/<div class="row-btns guia-app">\s*<span class="sub">En la app:<\/span>\s*<\/div>/g, '')) }];
    if (st.model) {
      const tmp = document.createElement('div');
      tmp.innerHTML = pasosHTML(pasosCtx());
      docs.push({ name: 'Paso a paso - varianza, covarianza, correlacion y betas.html', html: PF.pasos.documentHTML('Paso a paso: varianza, covarianza, desviación, correlación, betas y frontera eficiente', tmp.innerHTML) });
    }
    const data = macroData();
    if (Object.keys(data).length) {
      const prev = st.screen;
      st.screen = 'macro';
      renderMacro();
      st.screen = prev;
      docs.push({ name: 'Variables macroeconomicas y mercado.html', html: PF.pasos.documentHTML('Variables macroeconómicas de Colombia y mercado de valores', $('macro-cards').innerHTML + '<h2>Relación de cada activo con cada variable</h2>' + $('macro-table').innerHTML) });
    }
    docs.push({ name: 'Sistema economico y sistema financiero en Colombia.html', html: PF.pasos.documentHTML('Sistema económico y sistema financiero en Colombia', sistemaBaseHTML() + sistemaIdxHTML()) });
    docs.push({ name: 'Como obtener cada dato.html', html: PF.pasos.documentHTML('Cómo obtener cada dato que pide la app', $('guia-datos').innerHTML) });
    docs.push({ name: 'Teoria de portafolios.html', html: PF.pasos.documentHTML('Teoría de portafolios', $('screen-teoria').innerHTML) });
    return docs;
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
    if (saved) {
      // Ajustes de versiones anteriores: el tope de 20-30 % por acción ya no es el predeterminado
      if (saved.div == null) delete saved.wmax;
      for (const id of SETTING_IDS) if (saved[id] != null && $(id)) $(id).value = saved[id];
    }
    $('csv').value = store.get('csv') || PF.sample.csv();

    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.getAttribute('data-go'))));
    $('guia').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-guia-go]');
      if (b) return go(b.getAttribute('data-guia-go'));
      const a = ev.target.closest('[data-guia-to]');
      if (a) {
        ev.preventDefault();
        const el = document.getElementById('guia-' + a.getAttribute('data-guia-to'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    $('btn-sample').addEventListener('click', () => {
      $('csv').value = PF.sample.csv();
      $('kind').value = 'prices';
      $('freq').value = 'mensual';
      st.userNames = null;
      parse(false);
    });
    $('btn-parse').addEventListener('click', () => {
      st.userNames = null;
      if (!pastedSeries()) parse(false);
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
      if (!pastedSeries()) parse(false);
    }, 0));
    const recompute = debounce(compute, 250);
    for (const id of ['kind', 'market', 'mumodel', 'covmodel']) $(id).addEventListener('change', compute);
    for (const id of ['agg', 'fill']) $(id).addEventListener('change', () => {
      if (st.series && $('csv').value === st.mergedText) mergeLoaded(true);
    });
    for (const id of ['rettype', 'history', 'div']) $(id).addEventListener('change', compute);
    wirePasos();
    wireMacro();
    wireLib();
    $('sistema').addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset && t.dataset.shares) {
        const all = store.get('shares') || {};
        const v = PF.data.parseNumber(String(t.value), true);
        if (v > 0) all[t.dataset.shares] = v;
        else delete all[t.dataset.shares];
        store.set('shares', all);
        renderSistemaIdx();
      } else if (t.id === 'idx-method') {
        store.set('idxMethod', t.value);
        renderSistemaIdx();
      }
    });
    const savedSegs = store.get('segs');
    if (Array.isArray(savedSegs)) document.querySelectorAll('#segs [data-seg]').forEach((c) => (c.checked = savedSegs.includes(c.getAttribute('data-seg'))));
    $('segs').addEventListener('change', () => {
      store.set('segs', settings().segs);
      st.userNames = null;
      compute();
    });
    $('colibr-note').addEventListener('click', (ev) => {
      if (!ev.target.closest('#use-colibr') || st.colibr == null) return;
      const v = Math.round(st.colibr * 10000) / 100;
      $('rf').value = v;
      $('plan-safe').value = v;
      store.set('plan', Object.assign(store.get('plan') || {}, { 'plan-safe': String(v) }));
      compute();
    });
    for (const id of ['inst-table', 'pick-assets'])
      $(id).addEventListener('change', (ev) => {
        const t = ev.target.closest('[data-pick]');
        if (t) setPicked([t.getAttribute('data-pick')], t.checked);
      });
    $('pick-assets').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pick-all]');
      if (b) setPicked(candidates(settings()), b.getAttribute('data-pick-all') === '1');
    });
    $('inst-table').addEventListener('change', (ev) => {
      const sel = ev.target.closest('[data-cls]');
      if (!sel) return;
      const o = store.get('cls') || {};
      o[sel.getAttribute('data-cls')] = sel.value;
      store.set('cls', o);
      st.userNames = null;
      compute();
    });
    $('freq').addEventListener('change', () => {
      // Con historiales diarios subidos, se reagrupan a la nueva frecuencia.
      if (st.series && $('csv').value === st.mergedText) mergeLoaded(true);
      else compute();
    });
    $('currency').addEventListener('change', () => {
      store.set('settings', Object.fromEntries(SETTING_IDS.map((id) => [id, $(id).value])));
      if (st.model) render();
    });
    for (const id of ['rf', 'em', 'wmin', 'wmax', 'capital', 'fee', 'feesell']) $(id).addEventListener('input', recompute);
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
    const planSync = debounce(() => {
      const b = val('plan-budget');
      const f = val('plan-fee');
      const fs = val('plan-feesell');
      if (b != null) $('capital').value = b;
      if (f != null) $('fee').value = f;
      if (fs != null) $('feesell').value = fs;
      compute();
    }, 350);
    for (const id of ['plan-budget', 'plan-fee', 'plan-feesell']) $(id).addEventListener('input', planSync);
    const PLAN_IDS = ['plan-horizon', 'plan-min', 'plan-safe', 'plan-loss', 'plan-base'];
    const savedPlan = store.get('plan');
    if (savedPlan) for (const id of PLAN_IDS) if (savedPlan[id] != null) $(id).value = savedPlan[id];
    const planSave = () => store.set('plan', Object.fromEntries(PLAN_IDS.map((id) => [id, $(id).value])));
    for (const id of PLAN_IDS) $(id).addEventListener(id === 'plan-min' || id === 'plan-safe' ? 'input' : 'change', debounce(() => {
      planSave();
      if (st.model) renderPlan();
    }, 250));
    document.querySelector('.fee-presets').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-fee]');
      if (!b) return;
      const f = Math.round(FEE_NORMAL * +b.getAttribute('data-fee'));
      $('plan-fee').value = f;
      $('fee').value = f;
      if (+b.getAttribute('data-fee') === 1) {
        $('plan-feesell').value = FEE_NORMAL;
        $('feesell').value = FEE_NORMAL;
      }
      compute();
    });
    $('plan-optk').addEventListener('change', renderPlan);
    $('plan-out').addEventListener('click', (ev) => ev.target.closest('[data-go-where]') && go('invertir'));
    $('plan-out').addEventListener('click', (ev) => ev.target.closest('#plan-register') && registerPlan());
    for (const k of ['xlsx', 'cov', 'corr', 'ret', 'stats', 'ports', 'plan', 'macro', 'pasos', 'macrodoc']) $('dl-' + k).addEventListener('click', () => doDownload(k));
    $('mode-pesos').addEventListener('click', () => setMode('pesos'));
    $('mode-acciones').addEventListener('click', () => setMode('acciones'));
    const buysChanged = debounce(() => {
      store.set('buys', st.buys);
      if (!st.model || st.mode !== 'acciones') return;
      computeBuys();
      renderConfirm();
      renderCharts();
    }, 300);
    $('buys').addEventListener('input', (ev) => {
      const q = ev.target.getAttribute('data-bq');
      const d = ev.target.getAttribute('data-bd');
      const f = ev.target.getAttribute('data-bf');
      const i = q ?? d ?? f;
      if (i == null) return;
      const n = st.userNames[+i];
      st.buys[n] = Object.assign({}, st.buys[n], q != null ? { qty: ev.target.value } : d != null ? { date: ev.target.value } : { fee: ev.target.value });
      buysChanged();
    });
    $('buy-date').addEventListener('change', () => {
      const v = $('buy-date').value;
      (st.userNames || []).forEach((n, i) => {
        st.buys[n] = Object.assign({}, st.buys[n], { date: v });
        const el = $('bd-' + i);
        if (el) el.value = v;
      });
      buysChanged();
    });
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
    if (PF.terminal) PF.terminal.wire(() => PF.terminal.render(terminalCtx()));
    const savedMode = store.get('mode');
    if (savedMode === 'acciones') {
      st.mode = 'acciones';
      $('mode-pesos').setAttribute('aria-selected', 'false');
      $('mode-acciones').setAttribute('aria-selected', 'true');
      $('box-pesos').hidden = true;
      $('box-acciones').hidden = false;
    }
    const hash = (location.hash || '').slice(1);
    st.screen = document.getElementById('screen-' + hash) ? hash : 'datos';
    parse(false);
    go(st.screen);
    startLibrary();
  }

  /* Punto de entrada para la app de escritorio (js/desktop.js): carga historiales
   * ya descargados como si se hubieran subido archivos. */
  globalThis.PFApp = {
    // Historiales descargados por la app de escritorio: se agregan a la biblioteca (sin cambiar lo guardado)
    async saveToLibrary(series) {
      return saveDesktopSeries(series);
    },
    // Variables macro descargadas por la app de escritorio
    async setMacro(data) {
      for (const [k, d] of Object.entries(data || {})) if (d && d.dates) await PF.lib.saveMacro(k, d, d.source);
      await refreshLib();
      if (st.screen === 'macro') renderMacro();
    },
    macroData,
    documents,
    // Portafolio recomendado actual (para avisar cuando cambia con datos nuevos)
    recommended() {
      if (!st.model || !st.P || !st.P.recommended) return null;
      const r = st.P.recommended;
      return { names: st.model.names.slice(), w: r.w.slice(), ret: r.ret, vol: r.vol, date: st.parsed.dates.at(-1) };
    },
    async loadSeries(list, origin) {
      await PF.lib.saveSeries(PF.data.combineSeries(list), 'app de escritorio');
      await refreshLib();
      const usable = libSeries();
      if (usable.length < 2) {
        status('Se necesitan al menos dos activos con datos para el análisis.', 'bad');
        return false;
      }
      st.series = usable;
      const plan = suggestSettings(usable);
      const ok = mergeLoaded(false);
      if (ok) status(`Listo: ${usable.length} instrumentos de la biblioteca local, actualizada ${origin || ''}. ${plan}`.trim(), 'ok');
      return ok;
    },
    go,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
