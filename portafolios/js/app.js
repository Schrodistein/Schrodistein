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
    if (!$('csv').value.trim()) {
      // App vacía: todavía no se han subido archivos
      st.parsed = null;
      st.model = null;
      renderEmpty();
      return;
    }
    try {
      st.parsed = PF.data.parseCSV($('csv').value);
      if (!isDaily(st.parsed.dates)) throw new Error('La app trabaja siempre con cotizaciones diarias (una fila por rueda de la BVC, 242 al año). Los datos pegados o cargados tienen fechas semanales, mensuales o sin fecha: sube los históricos diarios de la BVC.');
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
  // Sin aproximar a cero: lo que con estos decimales se vería como 0 (y no es 0) va en notación científica
  const nf2 = (x) => (Number.isFinite(x) && x !== 0 && +Math.abs(x).toFixed(2) === 0 ? PF.data.sci(x, 2) : new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x));
  const nf1 = (x) => (Number.isFinite(x) && x !== 0 && +Math.abs(x).toFixed(1) === 0 ? PF.data.sci(x, 1) : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(x));
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
      // Documentos de Damodaran (prima por país, prima implícita): datos de referencia, no series de precios
      const ref = PF.riesgo.readReference(wb.SheetNames.map((n) => X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })), f.name);
      if (ref) return { reference: ref };
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
    // Documentos de referencia (Damodaran): se guardan para las primas de riesgo
    const refs = results.filter((r) => r.reference).map((r) => r.reference);
    if (refs.length) {
      const all = store.get('damRef') || {};
      for (const r of refs) {
        if (r.kind === 'betas') store.set('damodaran', { list: r.data.list, source: r.file, date: new Date().toISOString().slice(0, 10) });
        else all[r.kind] = Object.assign({ file: r.file, loaded: new Date().toISOString().slice(0, 10) }, r.data, { series: undefined });
      }
      store.set('damRef', all);
    }
    const refText = refs.map((r) => (r.kind === 'betas' ? `«${r.file}»: betas por industria de Damodaran (${r.data.list.length} industrias), ya disponibles en Paso a paso → sección 7` : r.kind === 'ctryprem' ? `«${r.file}»: ${r.data.country} (${r.data.rating}), diferencial ${pct(r.data.spread, 2)}, prima país ${pct(r.data.crp, 2)}, prima total ${pct(r.data.erp, 2)}, prima madura ${pct(r.data.mature, 2)}` : `«${r.file}»: prima implícita del S&P 500 ${r.data.year} = ${pct(r.data.erp, 2)} (${r.data.method})`)).join('; ');
    if (refs.length && results.every((r) => r.reference || r.error)) {
      status(`Documentos de Damodaran leídos: ${refText}. Se usan en Datos → Renta fija → Prima de riesgo y riesgo país.${errors.length ? ' No se pudieron leer: ' + errors.map((e) => e.error).join(' ') : ''}`, errors.length ? 'warn' : 'ok');
      if (st.screen === 'datos') renderRf();
      return;
    }
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
    shareWithMarket(combined);
    // Todo lo leído queda en la biblioteca local; el análisis usa la biblioteca completa
    const saved = await PF.lib.saveSeries(combined, 'archivo');
    await refreshLib();
    const usable = libSeries();
    // Solo curvas de referencia (tasas cero cupón de TES): quedan para la tasa libre de riesgo
    if (combined.every((x) => x.ref)) {
      status(`Series de referencia guardadas en la biblioteca: ${combined.map((x) => `${x.name} (${x.dates[0]} a ${x.dates[x.dates.length - 1]})`).join('; ')}${refText ? '. ' + refText : ''}. Se usan en Datos → Renta fija para la tasa libre de riesgo y la prima por riesgo país; no entran al portafolio.${allErr ? ' No se pudieron leer: ' + allErr : ''}`, allErr ? 'warn' : 'ok');
      if (st.screen === 'datos') renderRf();
      return;
    }
    if (usable.length < 2 && combined.length >= 2) {
      status(`Los archivos quedaron guardados en la biblioteca, pero sus fechas caen fuera de la ventana de análisis (${windowText()}): ${combined.map((x) => `${x.name} ${x.dates[0]} a ${x.dates[x.dates.length - 1]}`).join('; ')}. Cambia las fechas de inicio y de corte en Biblioteca.${allErr ? ' Además: ' + allErr : ''}`, 'bad');
      return;
    }
    if (usable.length < 2) {
      status(`Solo hay un instrumento en la biblioteca (${combined[0].name}). Sube también los archivos de tus otras acciones y del índice de mercado (por ejemplo el COLCAP).${allErr ? ' Además: ' + allErr : ''}`, 'bad');
      return;
    }
    st.series = usable;
    const plan = suggestSettings(usable);
    if (mergeLoaded(false)) status(`Listo: ${combined.length} instrumentos leídos de ${files.length - errors.length} archivos y guardados en la biblioteca (${saved.agregadas.toLocaleString('es-CO')} fechas nuevas${saved.nuevas ? `, ${saved.nuevas} instrumentos nuevos` : ''}; los valores ya guardados no cambian). El análisis usa los ${usable.length} instrumentos de la biblioteca. ${plan}${allErr ? ' No se pudieron leer: ' + allErr : ''}`, allErr ? 'warn' : 'ok');
  }

  /* App de escritorio: lo que se sube en Datos queda también en Mercado (sin volver a cargarlo).
   * Las series de referencia (tasas cero cupón, Tesoro de EE. UU., EMBIG) no son activos de Mercado. */
  function shareWithMarket(list) {
    const api = globalThis.bvc;
    if (!api || !api.agregar) return;
    const out = list
      .filter((x) => !x.ref)
      .map((x) => ({ name: x.name, dates: x.dates, prices: x.kind === 'tasa' && x.rates ? x.rates : x.prices, qty: x.qty, vol: x.vol, cls: x.cls, kind: x.kind, dur: x.dur }));
    if (!out.length) return;
    api.agregar(out).then(
      (r) => {
        if (r && Object.keys(r.assets).length) globalThis.dispatchEvent(new CustomEvent('pf:mercado', { detail: r }));
      },
      () => {}
    );
  }

  /* La frecuencia es fija: cotizaciones diarias, una por rueda de la BVC (242 al año). */
  function suggestSettings(list) {
    const dates = [...new Set(list.flatMap((x) => x.dates))];
    const lag = PF.data.detectLags(list).length ? ' Hay series que parecen desfasadas: revisa la nota en Datos.' : '';
    return `Cotizaciones diarias: ${dates.length.toLocaleString('es-CO')} ruedas de la BVC (242 al año).${lag}`;
  }
  /* ¿Las fechas son diarias? (mediana de la separación entre fechas de hasta 4 días) */
  function isDaily(dates) {
    const ds = [...new Set(dates)].sort();
    const gaps = ds.slice(1).map((d, i) => (Date.parse(d) - Date.parse(ds[i])) / 864e5).sort((a, b) => a - b);
    return gaps.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(ds[0]) && gaps[Math.floor(gaps.length / 2)] <= 4;
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
  /* ---------- Datos → submenú: renta variable, renta fija (tasa libre de riesgo) y guía ---------- */
  function datosSub(name, fromGo) {
    const sub = ['variable', 'fija', 'guia'].includes(name) ? name : 'variable';
    // Al cambiar de parte dentro de Datos también se recuerda dónde quedó cada una
    const switching = !fromGo && st.screen === 'datos' && store.get('datosSub') !== sub;
    if (switching) saveScroll();
    store.set('datosSub', sub);
    document.querySelectorAll('#screen-datos [data-sub]').forEach((el) => {
      if (el.closest('#datos-sub')) return el.getAttribute('data-sub') === sub ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current');
      el.hidden = !el.getAttribute('data-sub').split(' ').includes(sub);
    });
    if (sub === 'fija') renderRf();
    if (switching) restoreScroll();
  }
  // Serie de rendimientos logarítmicos diarios → σ anual (242 ruedas)
  function annualVol(s) {
    const r = [];
    for (let i = 1; i < s.prices.length; i++) if (s.prices[i] > 0 && s.prices[i - 1] > 0) r.push(Math.log(s.prices[i] / s.prices[i - 1]));
    return r.length > 20 ? Math.sqrt(PF.stats.variance(r) * 242) : NaN;
  }
  // σ acciones / σ bonos: MSCI COLCAP frente al índice COLTES (LP si está), con la ventana de análisis
  function volRatio() {
    if (!st.model) return NaN;
    const list = libSeries();
    const b = list.find((s) => /coltes\s*lp/i.test(s.name)) || list.find((s) => /coltes/i.test(s.name) && s.kind !== 'tasa');
    const vb = b ? annualVol(b) : NaN;
    return vb > 0 ? st.model.mktVol / vb : NaN;
  }
  const lastInflation = () => {
    const d = macroData().inflacion;
    return d && d.values.length ? d.values[d.values.length - 1] / 100 : NaN;
  };
  // Tasa del TES en pesos más cercana a 10 años (no UVR: esa es tasa real)
  const tes10Of = (list) => list.filter((s) => s.kind === 'tasa' && /tes|tfit/i.test(s.name) && !/uvr/i.test(s.name)).sort((a, b) => Math.abs((a.dur || 0) - 10) - Math.abs((b.dur || 0) - 10))[0];
  /* Datos para las primas: los de los archivos de referencia (con su fuente y fecha, hasta la fecha de
   * corte) y, encima, lo que el usuario escriba. inp en % (embi en pb, ratio en veces). */
  function prpAuto() {
    const refs = libRefSeries();
    const last = (role) => {
      const x = refs.find((r) => r.role === role);
      if (!x) return null;
      const y = x.rates || x.prices;
      return { v: y[y.length - 1], date: x.dates[x.dates.length - 1], name: x.name };
    };
    const auto = {};
    const put = (k, v, from, date) => Number.isFinite(v) && (auto[k] = { v, from, date });
    const t10 = last('tes-cop-10') || (() => {
      const t = tes10Of(libSeries().concat(refs));
      return t ? { v: (t.rates || t.prices).at(-1), date: t.dates.at(-1), name: t.name } : null;
    })();
    if (t10) put('tes10', t10.v * 100, t10.name, t10.date);
    const u10 = last('ust10');
    if (u10) put('ust10', u10.v * 100, u10.name, u10.date);
    const ie = last('infl-us');
    if (ie) put('pius', ie.v * 100, ie.name, ie.date);
    const uvr = last('tes-uvr-10');
    if (t10 && uvr) put('picol', ((1 + t10.v) / (1 + uvr.v) - 1) * 100, 'Inflación implícita en los TES: (1 + TES pesos 10 años) / (1 + TES UVR 10 años) − 1', uvr.date);
    else if (Number.isFinite(lastInflation())) put('picol', lastInflation() * 100, 'Última inflación anual (Banco de la República)', '');
    const em = last('embi');
    if (em) put('embi', em.v * 1e4, em.name, em.date);
    const D = store.get('damRef') || {};
    if (D.implied && Number.isFinite(D.implied.erp)) put('erp', D.implied.erp * 100, `Damodaran, prima implícita del S&P 500 (${D.implied.year}, ${D.implied.file})`, String(D.implied.year));
    else if (D.ctryprem && Number.isFinite(D.ctryprem.mature)) put('erp', D.ctryprem.mature * 100, `Damodaran, prima de un mercado maduro (${D.ctryprem.file})`, D.ctryprem.loaded);
    if (D.ctryprem && Number.isFinite(D.ctryprem.ratio)) put('ratio', D.ctryprem.ratio, `Damodaran: prima país / diferencial de ${D.ctryprem.country} (${pct(D.ctryprem.crp, 2)} / ${pct(D.ctryprem.spread, 2)})`, D.ctryprem.loaded);
    else if (Number.isFinite(volRatio())) put('ratio', volRatio(), 'Tus datos: σ del MSCI COLCAP / σ del COLTES', '');
    const user = store.get('prp') || {};
    const inp = {};
    const used = {};
    for (const k of ['tes10', 'ust10', 'picol', 'pius', 'embi', 'ratio', 'erp']) {
      if (user[k] != null && user[k] !== '' && Number.isFinite(+user[k])) {
        inp[k] = +user[k];
        used[k] = { v: +user[k], from: 'Escrito por ti', date: '' };
      } else if (auto[k]) {
        inp[k] = auto[k].v;
        used[k] = auto[k];
      }
    }
    return { inp, auto, used };
  }
  function crpForPasos() {
    const D = store.get('damRef') || {};
    const tax = D.ctryprem && Number.isFinite(D.ctryprem.tax) ? D.ctryprem.tax : null;
    if (store.get('crpManual') && Number.isFinite(store.get('crp'))) return { crp: store.get('crp'), crpSrc: 'escrita por ti', taxDefault: tax };
    const pa = prpAuto();
    const rf = parseFloat($('rf').value) / 100;
    const q = PF.riesgo.premiums(pa.inp, { rf, volRatio: pa.inp.ratio });
    if (Number.isFinite(q.prp)) return { crp: q.prp, crpSrc: `calculada en Datos → Renta fija: ${q.spreadSrc === 'EMBI' ? 'EMBIG' : 'diferencial de los TES'} ${pct(q.spread, 2)} × ${String(q.ratio.toFixed(2)).replace('.', ',')} (σ acciones / σ bonos)`, taxDefault: tax };
    if (D.ctryprem && Number.isFinite(D.ctryprem.crp)) return { crp: D.ctryprem.crp, crpSrc: `de Damodaran (${D.ctryprem.country}, ${D.ctryprem.rating})`, taxDefault: tax };
    return { crp: 0, crpSrc: '', taxDefault: tax };
  }
  function setRf(v) {
    // Una tasa absurda (p. ej. un índice leído como tasa) nunca se aplica
    if (!(+v > -5 && +v < 50)) {
      showBanner(`La tasa ${String(v).replace('.', ',')} % no es una tasa libre de riesgo válida (debe estar entre −5 % y 50 % efectivo anual). Revisa el archivo de origen.`);
      return;
    }
    $('rf').value = v;
    compute();
  }
  function renderRf() {
    if (!$('rf-panel')) return;
    const rfNow = parseFloat($('rf').value) / 100;
    $('rf-now').innerHTML = `Tasa libre de riesgo en uso (Datos → Renta variable → Supuestos): <b>${pct(rfNow, 2)}</b> efectiva anual. Con rendimientos logarítmicos diarios equivale a <code>ln(1 + rf) / 242</code> = ${Number.isFinite(rfNow) ? (PF.riesgo.dailyLog(rfNow) * 100).toFixed(4).replace('.', ',') + ' %' : '—'} por rueda. La ventana de análisis es ${windowText()}.`;
    const list = libSeries().concat(libRefSeries());
    const c = PF.riesgo.rfCandidates(list);
    const use = (x) => (Number.isFinite(x) ? `<button type="button" class="btn btn-use" data-use-rf="${(Math.round(x * 10000) / 100).toFixed(2)}">Usar ${pct(x, 2)}</button>` : '');
    const chip = (x) => (/uvr/i.test(x.name) ? '<span class="chip chip-real">Real · UVR</span>' : x.role && /^tes-/.test(x.role) ? '<span class="chip chip-cop">Pesos · cero cupón</span>' : x.tipo.startsWith('Índice') ? '<span class="chip">Índice BVC</span>' : '<span class="chip">Tasa negociada</span>');
    $('rf-cands').innerHTML = c.length
      ? `<div class="hscroll" tabindex="0" aria-label="Candidatas a tasa libre de riesgo: desliza a los lados para ver todas las columnas"><table class="data rf-cands"><thead><tr><th class="stick">Instrumento</th><th>Tipo</th><th>Plazo</th><th class="n">Último dato</th><th class="n">Promedio</th><th>Fecha</th><th>Cómo se usa</th><th></th></tr></thead><tbody>${c
          .map((x) => `<tr><td class="stick"><b>${esc(x.name)}</b></td><td>${chip(x)}</td><td>${esc(x.plazo)}</td><td class="n big-n">${pct(x.value, 2)}</td><td class="n">${pct(x.avg, 2)}</td><td>${esc(x.date || '')}</td><td class="note">${esc(x.note)}</td><td>${use(x.value)}</td></tr>`)
          .join('')}</tbody></table></div><p class="scroll-hint"><button type="button" class="scroll-btn" data-hscroll="-1" aria-label="Desplazar la tabla a la izquierda">◀</button> Desliza la tabla para ver todas las columnas <button type="button" class="scroll-btn" data-hscroll="1" aria-label="Desplazar la tabla a la derecha">▶</button></p><p class="hint">Los índices COLTES y COLIBR son de rendimiento total: su cifra es lo que <i>rindió</i> mantenerlos (efectivo anual, base 365 días), no la tasa a la que se negocian hoy. La tasa de un TES sí es la de hoy. Para un análisis a un año, la referencia es el TES de 1 año o el COLIBR; para valorar acciones a largo plazo, el TES de 10 años menos el diferencial por riesgo de impago (abajo).</p>`
      : '<p class="hint">Todavía no hay renta fija en la biblioteca. Sube el COLIBR, los COLTES (CP, LP, UVR) o las tasas de los TES con el botón de arriba.</p>';
    // Primas: datos tomados de los archivos cargados (o escritos por el usuario)
    const pa = prpAuto();
    const rfOk = Number.isFinite(rfNow) && rfNow > -0.05 && rfNow < 0.5;
    document.querySelectorAll('#prp-form [data-prp]').forEach((el) => {
      const k = el.getAttribute('data-prp');
      const u = (store.get('prp') || {})[k];
      if (document.activeElement !== el) el.value = u != null ? u : '';
      const a = pa.auto[k];
      el.placeholder = a ? `${String(+a.v.toFixed(k === 'embi' ? 0 : 2)).replace('.', ',')} (del archivo)` : '';
      el.title = a ? `${a.from}${a.date ? ', ' + a.date : ''}` : '';
    });
    const q = PF.riesgo.premiums(pa.inp, { rf: rfOk ? rfNow : NaN, volRatio: pa.inp.ratio });
    $('prp-out').innerHTML = PF.riesgo.sourcesHTML({ pct, esc }, pa) + PF.riesgo.premiumHTML({ pct, esc }, q) + PF.riesgo.damodaranHTML({ pct, esc }, store.get('damRef'), q);
    const dr = (store.get('damRef') || {}).ctryprem;
    $('prp-btns').innerHTML = [
      dr && Number.isFinite(dr.crp) ? `<button type="button" class="btn" data-use-prp="${(dr.crp * 100).toFixed(2)}">Usar PRP de Damodaran ${pct(dr.crp, 2)}</button>` : '',
      Number.isFinite(q.prp) ? `<button type="button" class="btn" data-use-prp="${(q.prp * 100).toFixed(2)}">Usar PRP ${pct(q.prp, 2)} en la beta de Damodaran</button>` : '',
      Number.isFinite(q.rfLocal) ? `<button type="button" class="btn" data-use-rf="${(q.rfLocal * 100).toFixed(2)}">Usar rf local ${pct(q.rfLocal, 2)} como tasa libre de riesgo</button>` : '',
      Number.isFinite(q.em) ? `<button type="button" class="btn btn-primary" data-use-em="${(q.em * 100).toFixed(2)}">Usar E(Rm) = ${pct(q.em, 2)} en Supuestos</button>` : '',
    ].join(' ');
  }
  function wireRf() {
    $('datos-sub').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-sub]');
      if (b) datosSub(b.getAttribute('data-sub'));
    });
    $('file-fija').addEventListener('change', async (ev) => {
      const el = $('rf-status');
      el.hidden = false;
      el.className = 'status';
      el.textContent = 'Leyendo…';
      await loadFiles(ev.target.files);
      ev.target.value = '';
      const u = $('upload-status');
      el.className = u.className;
      el.textContent = u.textContent;
      renderRf();
    });
    $('prp-form').addEventListener('change', (ev) => {
      const k = ev.target.getAttribute('data-prp');
      if (!k) return;
      const all = store.get('prp') || {};
      const v = parseFloat(String(ev.target.value).replace(',', '.'));
      if (Number.isFinite(v)) all[k] = v;
      else delete all[k];
      store.set('prp', all);
      renderRf();
    });
    // Flechas para desplazar una tabla ancha (en celular la barra del sistema se oculta)
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-hscroll]');
      if (!b) return;
      const box = b.closest('.scroll-hint') && b.closest('.scroll-hint').previousElementSibling;
      if (box && box.classList.contains('hscroll')) box.scrollBy({ left: +b.dataset.hscroll * Math.max(160, box.clientWidth * 0.8), behavior: 'smooth' });
    });
    // Botones «Usar…» de Renta fija y de Paso a paso
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-use-rf],[data-use-em],[data-use-prp]');
      if (!b) return;
      if (b.dataset.useRf) setRf(b.dataset.useRf);
      else if (b.dataset.useEm) {
        $('em').value = b.dataset.useEm;
        compute();
      } else if (b.dataset.usePrp) {
        store.set('crp', parseFloat(b.dataset.usePrp) / 100);
        store.set('crpManual', true);
        renderPasos();
      }
      b.textContent = '✓ Aplicado';
      if (st.screen === 'datos') renderRf();
    });
  }

  const SCREEN_RENDERERS = { datos: () => (renderGuia(), store.get('datosSub') === 'fija' && renderRf()), estadistica: () => renderPasos(), macro: () => renderMacro(), sistema: () => renderSistema(), biblioteca: () => renderLib() };
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
      if (has.some((r) => !r.hit.exact && !r.hit.after)) notes.push('* El cierre usado no es el del día de compra: ese día no hubo negociación del activo y se usó el último cierre anterior.');
      if (has.some((r) => r.hit.after)) notes.push('* Alguna fecha de compra es posterior al último dato cargado: se usó el último cierre disponible.');
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
    return { m, P: st.P, table: st.table || st.parsed, marketIdx: st.s.market, s: Object.assign({}, st.s, { marketReturnSet: st.s.marketReturn != null }), extra, plan: null, generated: stamp() };
  }

  /* Matrices de cálculo adicionales (las del paso a paso): CSV sueltos y hojas del libro de Excel. */
  function calcMatrices() {
    const m = st.model;
    const P = st.P;
    if (!m || !P) return [];
    const sel = PORTS.find((p) => p.key === st.sel && P[p.key]) || PORTS[0];
    const E = P[sel.key];
    const out = [];
    // Desviaciones respecto a la media (por periodo)
    const p = st.table || st.parsed;
    const R = PF.data.toReturns(p.values, st.s.kind, st.s.retType === 'log');
    const idx = m.names.map((n) => p.names.indexOf(n));
    const dates = p.dates.slice(st.s.kind === 'prices' ? 1 : 0);
    const means = idx.map((i) => {
      const v = R[i].filter(Number.isFinite);
      return v.reduce((a, x) => a + x, 0) / v.length;
    });
    out.push({ key: 'desv', label: 'Desviaciones respecto a la media', sheet: 'Desv_media', rows: [['Fecha'].concat(m.names.map((n) => `${n}: r − r̄`))].concat(dates.map((d, t) => [d].concat(idx.map((i, k) => (Number.isFinite(R[i][t]) ? R[i][t] - means[k] : ''))))) });
    // Covarianzas ponderadas del portafolio elegido
    out.push({ key: 'pond', label: `Covarianzas ponderadas wᵢwⱼσᵢⱼ (${sel.label})`, sheet: 'Cov_ponderada', rows: [[`wᵢwⱼσᵢⱼ · ${sel.label}`].concat(m.names)].concat(m.names.map((n, i) => [n].concat(m.Sigma[i].map((c, j) => E.w[i] * E.w[j] * c))), [[], ['Varianza del portafolio σp² (suma)', E.vol * E.vol], ['Desviación σp', E.vol]]) });
    // Frontera eficiente
    out.push({ key: 'front', label: 'Puntos de la frontera eficiente', sheet: 'Frontera_puntos', rows: [['Punto', 't', 'E(Rp)', 'σp', 'Sharpe'].concat(m.names)].concat(P.frontier.map((q, k) => [k + 1, P.front[k] && Number.isFinite(P.front[k].t) ? P.front[k].t : 'max', q.ret, q.vol, (q.ret - m.rf) / q.vol].concat(q.w))) });
    // CML y SML
    const tan = P.tangency;
    const cml = [['σp', 'E(Rp) en la CML', '% en el tangente', '% en renta fija segura']];
    if (tan) for (let k = 0; k <= 20; k++) {
      const v = (tan.vol * 1.5 * k) / 20;
      cml.push([v, m.rf + ((tan.ret - m.rf) / tan.vol) * v, v / tan.vol, 1 - v / tan.vol]);
    }
    const sml = [['Activo o portafolio', 'β', 'E(R) esperado', 'E(R) exigido por la SML', 'α de Jensen']].concat(m.assets.map((a) => [a.name, a.betaM, a.expRet, m.rf + a.betaM * (m.Em - m.rf), a.expRet - (m.rf + a.betaM * (m.Em - m.rf))]), PORTS.filter((q) => P[q.key]).map((q) => [q.label, P[q.key].beta, P[q.key].ret, m.rf + P[q.key].beta * (m.Em - m.rf), P[q.key].jensen]));
    out.push({ key: 'cml', label: 'Línea del mercado de capitales (CML)', sheet: 'CML', rows: cml });
    out.push({ key: 'sml', label: 'Línea del mercado de valores (SML)', sheet: 'SML', rows: sml });
    // Elección de activos en el tangente
    if (tan) {
      const bT = PF.frontera.betasTo(m, tan.w);
      out.push({ key: 'elec', label: 'Elección de activos (portafolio tangente)', sheet: 'Eleccion_activos', rows: [['Activo', 'E(Rᵢ) − rf', 'βᵢ,T', 'Prima exigida βᵢ,T(E(R_T) − rf)', 'Diferencia', 'Peso en T']].concat(m.names.map((n, i) => [n, m.mu[i] - m.rf, bT[i], bT[i] * (tan.ret - m.rf), m.mu[i] - m.rf - bT[i] * (tan.ret - m.rf), tan.w[i]])) });
    }
    // Correlación promedio
    const ac = PF.frontera.avgCorr(m, E.w);
    out.push({ key: 'corrp', label: `Correlación promedio (${sel.label})`, sheet: 'Corr_promedio', rows: [['Par', 'ρᵢⱼ', '2wᵢwⱼσᵢσⱼ', 'Aporte 2wᵢwⱼσᵢσⱼρᵢⱼ']].concat(ac.list.map((q) => [`${m.names[q.i]} – ${m.names[q.j]}`, q.r, q.k, q.k * q.r]), [[], ['Promedio simple ρ̄', ac.simple], ['Promedio ponderado ρ̄p', ac.weighted], ['Σ wᵢ²σᵢ²', ac.own], ['(Σ wᵢσᵢ)²', ac.naive * ac.naive], ['σp²', ac.varP]]) });
    // Contribución al riesgo de cada portafolio
    const list = PORTS.filter((q) => P[q.key]);
    out.push({ key: 'contrib', label: 'Contribución al riesgo por portafolio', sheet: 'Contrib_riesgo', rows: [['Activo'].concat(list.map((q) => q.label))].concat(m.names.map((n, i) => [n].concat(list.map((q) => P[q.key].riskContrib[i])))) });
    return out;
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
      download(documents().find((d) => /^Paso a paso/.test(d.name)).html, `paso-a-paso-${stamp()}.html`, 'text/html;charset=utf-8');
      return dlStatus('Documento paso a paso generado.', 'ok');
    }
    const m = st.model;
    try {
      if (kind === 'xlsx') {
        if (st.s.kind !== 'prices') return dlStatus('El libro de Excel necesita precios; en Datos, los datos cargados son rendimientos.', 'bad');
        const rep = PF.report.build(reportContext());
        // Hojas adicionales con las matrices del paso a paso (valores)
        const fmt = (c) => (typeof c === 'number' && Number.isFinite(c) ? { v: c, s: 'num6' } : c);
        for (const x of calcMatrices()) rep.sheets.splice(rep.sheets.length - 1, 0, { name: x.sheet, rows: x.rows.map((r, k) => (k === 0 ? r.map((v) => ({ v, s: 'h' })) : r.map(fmt))), cols: [30].concat(Array.from({ length: Math.max(...x.rows.map((r) => r.length)) }, () => 14)), freeze: { row: 1, col: 1 } });
        download(rep.bytes(), `frontera-eficiente-calculos-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return dlStatus(`Libro generado con ${rep.sheets.length} hojas: ${rep.sheets.map((x) => x.name).join(', ')}.`, 'ok');
      }
      if (kind === 'corr') {
        // Excel con la matriz coloreada por nivel de correlación (verde +1, amarillo 0, rojo −1)
        const N = m.names.length;
        const rowsC = [[{ v: 'Matriz de correlación (rendimientos logarítmicos diarios)', s: 't' }], [{ v: 'Colores: verde = correlación directa (+1, perfecta directa), amarillo = sin correlación lineal (0), rojo = correlación inversa (−1, perfecta inversa).', s: 'n' }], [{ v: '', s: 'h' }].concat(m.names.map((n) => ({ v: n, s: 'h' })))]
          .concat(m.names.map((n, i) => [{ v: n, s: 'b' }].concat(m.corr[i].map((v) => ({ v, s: 'num4' })))))
          .concat([[], [{ v: 'Colores', s: 'b' }]], PF.stats.LIKERT.slice().reverse().map((q) => [q.label, { v: q.desc, s: 'n' }]));
        const bytes = PF.xlsx.build([{ name: 'Correlacion', rows: rowsC, cols: [24].concat(m.names.map(() => 12)), freeze: { row: 3, col: 1 }, colorScale: [`B4:${PF.xlsx.colName(N)}${3 + N}`] }]);
        download(bytes, `matriz-correlacion-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return dlStatus('Matriz de correlación en Excel, coloreada por nivel de correlación.', 'ok');
      }
      let rows;
      let name;
      const extraM = calcMatrices().find((x) => x.key === kind);
      if (extraM) {
        download(csv(extraM.rows), `${extraM.sheet.toLowerCase()}-${stamp()}.csv`, 'text/csv;charset=utf-8');
        return dlStatus(`${extraM.label}: listo.`, 'ok');
      }
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
    // Bonos de deuda pública (TES cero cupón del Banco de la República): segmento de renta fija,
    // con su tasa y el índice de rendimiento total de mantener el bono a plazo constante
    const have = new Set(list.map((x) => x.name));
    const tesOrder = (r) => (/uvr/.test(r.role) ? 100 : 0) + (r.dur || 0);
    libRefSeries()
      .filter((r) => /^tes-/.test(r.role || '') && r.rates && !have.has(r.name))
      .sort((a, b) => tesOrder(a) - tesOrder(b))
      .forEach((r) => list.push({ name: r.name, dates: r.dates, prices: r.prices, rates: r.rates, dur: r.dur, cls: 'tes' }));
    const market = st.model ? st.model.marketName : p.names[PF.data.guessMarket(p.names)];
    // El índice de referencia va primero
    list.sort((a, b) => (a.name === market ? -1 : b.name === market ? 1 : 0));
    const all = [...new Set(list.flatMap((x) => x.dates))].sort();
    const gaps = all.slice(1).map((d, i) => (Date.parse(d) - Date.parse(all[i])) / 864e5).sort((a, b) => a - b);
    const daily = gaps.length > 0 && gaps[Math.floor(gaps.length / 2)] <= 4;
    // Segmentos de la terminal: cada activo con su segmento y cada segmento con su índice
    const names = list.map((x) => x.name);
    const segIdx = (nm) => (/coltes|colibr|(^|\W)ibr(\W|$)/i.test(nm) ? 'fija' : /(^|\W)(trm|usd|cop|dolar|dólar|eur)(\W|$)/i.test(nm) ? 'divisas' : 'variable');
    for (const x of list) {
      x.cls = x.rates ? 'tes' : clsOf(x.name);
      x.seg = x.cls === 'indice' ? segIdx(x.name) : segOf(x.cls);
    }
    const pickBench = (seg) => {
      if (seg === 'variable') return market;
      const res = seg === 'fija' ? [/coltes\s*lp/i, /coltes/i, /colibr|(^|\W)ibr(\W|$)/i] : [/(^|\W)trm(\W|$)/i, /usd/i, /dolar|dólar/i];
      for (const re of res) {
        const hit = names.find((nm) => re.test(nm) && list.find((x) => x.name === nm).seg === seg);
        if (hit) return hit;
      }
      // Sin COLTES ni COLIBR: el TES cero cupón en pesos a 10 años hace de referencia de la renta fija
      if (seg === 'fija') return names.find((nm) => /cero cup[oó]n pesos 10/i.test(nm)) || null;
      return null;
    };
    const segs = { variable: { label: 'Renta variable', bench: pickBench('variable') }, fija: { label: 'Renta fija', bench: pickBench('fija') }, divisas: { label: 'Divisas', bench: pickBench('divisas') } };
    return { list, market, daily, f: st.model ? st.model.f : 12, segs };
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
      const ports = PORTS.filter((p) => P[p.key]).map((p) => ({ key: 'front:' + p.key, label: p.short, vol: P[p.key].vol, ret: P[p.key].ret, sel: p.key === st.sel, shape: p.shape, tip: portTip(p.title, P[p.key]) }));
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
        ports: c.tangency ? [{ key: 'conf:tangent', label: 'Tangente', vol: c.tangency.vol, ret: c.tangency.ret, tip: portTip('Tangente (máx. Sharpe)', c.tangency) }] : [],
        user: { key: 'conf:me', vol: c.me.vol, ret: c.me.ret, tip: portTip('Tu portafolio', c.me) },
        guides,
        aria: 'Tu portafolio frente a la frontera eficiente',
      });
      $('legend-confirm').innerHTML = `<span><i class="dot" style="background:var(--s3)"></i>Tu portafolio</span><span><i class="line" style="background:var(--s1)"></i>Frontera eficiente</span><span><i class="line" style="background:var(--s2)"></i>Línea del mercado de capitales</span><span><i class="dot" style="background:var(--ink)"></i>Eficientes con igual riesgo o igual rendimiento</span>`;
    }
  }

  /* ---------- Navegación ---------- */
  // Cada pestaña (y cada parte de Datos) recuerda dónde quedó la página: al volver se regresa ahí
  const scrollPos = Object.assign({}, store.get('scrollPos') || {});
  const scrollKey = (screen) => (screen === 'datos' ? 'datos:' + (store.get('datosSub') || 'variable') : screen);
  const saveScroll = () => {
    if (!st.screen) return;
    scrollPos[scrollKey(st.screen)] = Math.round(window.scrollY || 0);
    store.set('scrollPos', scrollPos);
  };
  let restoreTimer = null;
  function restoreScroll() {
    const y = scrollPos[scrollKey(st.screen)] || 0;
    clearTimeout(restoreTimer);
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    // Si la página todavía no era tan alta (gráficos o tablas dibujándose), se reintenta un momento,
    // siempre que el usuario no se haya movido desde el último intento
    let tries = 0;
    let at = window.scrollY;
    const retry = () => {
      if (Math.abs(window.scrollY - y) <= 2 || Math.abs(window.scrollY - at) > 2 || ++tries > 10) return;
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      at = window.scrollY;
      restoreTimer = setTimeout(retry, 120);
    };
    restoreTimer = setTimeout(retry, 60);
  }
  function go(screen) {
    if (screen === 'comprar') screen = 'frontera'; // la pestaña Comprar se quitó
    saveScroll();
    if (screen === 'guia') {
      screen = 'datos'; // la guía está dentro de Datos
      store.set('datosSub', 'guia');
    }
    if (!document.getElementById('screen-' + screen)) screen = 'datos';
    st.screen = screen;
    document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== 'screen-' + screen));
    document.querySelectorAll('.tabs button').forEach((b) => (b.getAttribute('data-go') === screen ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    const cur = document.querySelector('.tabs button[aria-current="page"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    try {
      history.replaceState(null, '', '#' + screen);
    } catch (e) {
      /* marco sin historial */
    }
    if (screen === 'invertir') renderWhere();
    if (screen === 'datos') datosSub(store.get('datosSub') || 'variable', true);
    renderScreen(screen);
    renderCharts();
    restoreScroll();
  }

  function renderWhere() {
    const r = PF.where.render({ plan: null, money, pct, segOf, clsOf, SEGS });
    $('where-plan').innerHTML = `<h2>Canales para invertir</h2>${r.summary}`;
    $('where-cards').innerHTML = r.cards;
    $('where-steps').innerHTML = r.steps;
  }

  /* ---------- Biblioteca local ---------- */
  st.lib = { series: [], macro: {} };
  // Ventana del análisis: por ahora del 22/08/2023 al 22/08/2026 (tres años de ruedas). Se fija una vez
  // por versión; después se cambia en Biblioteca (fecha de inicio y fecha de corte).
  const WINDOW = { inicio: '2023-08-22', corte: '2026-08-22', v: 1 };
  if (store.get('ventana') !== WINDOW.v) {
    store.set('inicio', WINDOW.inicio);
    store.set('corte', WINDOW.corte);
    store.set('ventana', WINDOW.v);
  }
  const libCut = () => store.get('corte') || '';
  const libFrom = () => store.get('inicio') || '';
  const windowText = () => (libFrom() && libCut() ? `del ${fmtDay(libFrom())} al ${fmtDay(libCut())}` : libCut() ? `hasta el ${fmtDay(libCut())}` : libFrom() ? `desde el ${fmtDay(libFrom())}` : 'con todos los datos guardados');
  const fmtDay = (d) => d.split('-').reverse().join('/');
  async function refreshLib() {
    // Un solo activo por nemotécnico, siempre (tramos con número de descarga u otros nombres del mismo activo)
    await PF.lib.mergeDuplicates().catch(() => 0);
    st.lib = await PF.lib.all();
    if (st.screen === 'biblioteca') renderLib();
  }
  // Series para el análisis: las marcadas «usar», hasta la fecha de corte
  const libSeries = () =>
    PF.data.combineSeries(
      st.lib.series
        .filter((r) => r.use !== false && !r.ref)
        .map((r) => PF.lib.toSeries(r, libCut(), libFrom()))
        .filter((x) => x.dates.length >= 3)
    );
  // Curvas de referencia (tasas cero cupón de TES): para la tasa libre de riesgo, no para el portafolio
  const libRefSeries = () =>
    PF.data.combineSeries(st.lib.series.filter((r) => r.ref).map((r) => PF.lib.toSeries(r, libCut(), libFrom())).filter((x) => x.dates.length >= 3));
  function useLibrary(msg) {
    const usable = libSeries();
    if (usable.length < 2) return false;
    st.series = usable;
    const plan = suggestSettings(usable);
    const ok = mergeLoaded(true);
    if (ok) status(msg ? `${msg} ${plan}`.trim() : `Análisis con la biblioteca local: ${usable.length} instrumentos, ${windowText()}.`, 'ok');
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
    $('cat-summary').textContent = `${have} de ${cat.length} activos del catálogo están en la biblioteca. Los precios salen solo de la BVC y se cargan a mano: en bvc.com.co busca cada nemotécnico y descarga sus históricos (6 meses por archivo para acciones y ETF; un trimestre para los índices como el MSCI COLCAP). Súbelos en Datos${desk ? ' o con Mercado → «Importar archivos de la BVC»' : ''}: los tramos de un mismo activo se unen solos y quedan en la biblioteca.`;
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
    $('lib-from').value = libFrom();
    $('lib-summary').textContent = L.series.length
      ? `${L.series.length} instrumentos y ${Object.keys(L.macro).length} variables macro guardados, con ${n.toLocaleString('es-CO')} datos diarios. Los cálculos usan los datos ${windowText()}.`
      : 'La biblioteca está vacía: sube los históricos de la BVC en Datos (o actualiza en Mercado, en la app de escritorio) y quedan guardados aquí.';
    $('lib-table').innerHTML = L.series.length
      ? '<thead><tr><th>Usar</th><th>Instrumento</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th class="n">Datos</th><th>Cantidad y volumen</th><th>Fuente</th><th>Última fecha agregada</th><th></th></tr></thead><tbody>' +
        L.series
          .map((r) => `<tr><td><input type="checkbox" data-lib-use="${esc(r.name)}"${r.use !== false ? ' checked' : ''} aria-label="Usar ${esc(r.name)} en el análisis"></td><td>${esc(r.name)}</td><td>${r.ref ? 'Tasa de referencia (rf)' : esc(C[r.cls] || (r.kind === 'tasa' ? 'Renta fija' : ''))}</td><td>${esc(r.dates[0])}</td><td>${esc(last(r.dates))}</td><td class="n">${r.dates.length.toLocaleString('es-CO')}</td><td>${r.qty ? 'Sí' : '—'}</td><td>${esc(r.source)}</td><td>${esc(String(r.updated).slice(0, 10))}</td><td><button type="button" class="btn btn-ghost" data-lib-dl="${esc(r.name)}">Descargar CSV</button> <button type="button" class="btn btn-ghost" data-lib-del="${esc(r.name)}">Quitar</button></td></tr>`)
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
  function priceMatrix(calendar, fill) {
    let list = st.lib.series.filter((r) => r.use !== false && r.kind !== 'tasa');
    // Sin biblioteca (por ejemplo, con los datos de ejemplo o pegados): los datos cargados en Datos
    if (!list.length && st.parsed && st.parsed.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) list = st.parsed.names.map((name, i) => ({ name, dates: st.parsed.dates, prices: st.parsed.values[i] }));
    const mi = PF.data.guessMarket(list.map((r) => r.name));
    const market = list[mi] && PF.data.isMarketName(list[mi].name) ? list[mi].name : null;
    return PF.matriz.workbook(list, { calendar, market, cut: libCut(), from: libFrom(), fill, title: fill === false ? 'PRECIO DE CIERRE (ORIGINAL)' : 'PRECIO DE CIERRE' });
  }
  function wireLib() {
    const box = $('screen-biblioteca');
    // Dos matrices: la original (solo los cierres cotizados) y la completada (último precio en las ruedas sin negociación)
    const mxDownload = (fill) => {
      const el = $('mx-status');
      el.hidden = false;
      const { mx, bytes } = priceMatrix($('mx-cal').value, fill);
      if (!bytes) {
        el.className = 'status bad';
        el.textContent = 'La biblioteca no tiene precios todavía: carga archivos en Datos.';
        return;
      }
      download(bytes, `Matriz de precios ${fill === false ? 'original' : 'completada'} ${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const cells = mx.values.reduce((q, c) => q + c.filter(Number.isFinite).length, 0);
      const nFill = mx.filled.reduce((q, c) => q + c.filter(Boolean).length, 0);
      el.className = 'status ok';
      el.textContent = fill === false
        ? `Matriz original: ${mx.names.length} activos y ${mx.dates.length.toLocaleString('es-CO')} ruedas (${mx.dates[0]} a ${mx.dates[mx.dates.length - 1]}), ${cells.toLocaleString('es-CO')} cierres tal como los publicó la BVC; las celdas vacías son ruedas en que ese activo no se negoció.`
        : `Matriz completada: ${mx.names.length} activos y ${mx.dates.length.toLocaleString('es-CO')} ruedas (${mx.dates[0]} a ${mx.dates[mx.dates.length - 1]}); ${nFill.toLocaleString('es-CO')} celdas completadas con el último precio cotizado.`;
    };
    $('mx-download').addEventListener('click', () => mxDownload(true));
    $('mx-download-orig').addEventListener('click', () => mxDownload(false));
    box.addEventListener('change', async (ev) => {
      const t = ev.target;
      if (t.dataset.libUse) {
        await PF.lib.setUse(t.dataset.libUse, t.checked);
        await refreshLib();
        useLibrary();
      } else if (t.id === 'lib-cut' || t.id === 'lib-from') {
        store.set(t.id === 'lib-cut' ? 'corte' : 'inicio', t.value || '');
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
        // Fiel a la fuente: solo los días en que el activo se negoció
        const head = r.kind === 'tasa' ? 'Fecha;Nemotécnico;Tasa' : 'Fecha;Nemotécnico;Precio cierre' + (r.qty ? ';Cantidad;Volumen' : '');
        const rows = r.dates.map((d, i) => `${d};${r.name};${cell(r.kind === 'tasa' ? r.prices[i] * 100 : r.prices[i])}${r.qty && r.kind !== 'tasa' ? `;${cell(r.qty[i])};${cell(r.vol[i])}` : ''}`);
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
    // Tramos de un mismo activo guardados con nombres distintos (p. ej. con número de descarga): uno solo
    await PF.lib.mergeDuplicates().catch(() => 0);
    // La app no trae datos: la biblioteca empieza vacía y se llena con los archivos que se suben. Las series
    // que versiones anteriores (2.4 a 2.5.5) cargaban solas se quitan una vez; lo subido por el usuario no se toca.
    // 2.6.4: tampoco quedan las divisas que la app de escritorio descargaba sola (USD/COP, EUR/COP)
    if (store.get('autoFxPurge') !== 1) {
      const all = await PF.lib.all().catch(() => ({ series: [] }));
      for (const r of all.series || []) if ((r.source || '') === 'fuente automática (divisas)') await PF.lib.remove('series', r.name).catch(() => {});
      store.set('autoFxPurge', 1);
    }
    if (store.get('seedPurge') !== 1) {
      const SEEDED = /^(Banco de la República \(fuente: DANE(, GEIH)?\) · |Superintendencia Financiera \(datos\.gov\.co\) · Tasa de cambio representativa del mercado \(TRM\), diaria$|Banco de la República · Tasas cero cupón TES$)/;
      const all = await PF.lib.all().catch(() => ({ series: [], macro: {} }));
      for (const [k, d] of Object.entries(all.macro || {})) if (SEEDED.test(d.source || '')) await PF.lib.remove('macro', k).catch(() => {});
      for (const r of all.series || []) if (SEEDED.test(r.source || '')) await PF.lib.remove('series', r.name).catch(() => {});
      for (const k of ['banrepSeed', 'tesSeed']) store.set(k, null);
      store.set('seedPurge', 1);
    }
    await refreshLib();
    if (libSeries().length >= 2 && !(st.series && st.series.length)) useLibrary(`Datos cargados desde la biblioteca local: ${libSeries().length} instrumentos, ${windowText()}. Para agregar fechas nuevas, sube los archivos en Datos.`);
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
      dam: { list: (store.get('damodaran') || {}).list || null, source: (store.get('damodaran') || {}).source || '', inputs: store.get('dam') || {} },
      // Prima por riesgo país: la calculada en Datos → Renta fija pasa sola al Paso a paso (sección 7),
      // salvo que el usuario escriba otra ahí
      ...crpForPasos(),
      desktop: !!globalThis.bvc,
      sel: st.sel,
      ports: PORTS,
      user: st.conf && st.conf.me ? st.conf.me : null,
      tb: st.model ? PF.model.treynorBlack(st.model) : null,
      inflation: lastInflation(),
      macroRel: st.model ? PF.macro.relateAll(marketSeries(), macroData()) : {},
      prpAll: prpAuto(),
      damRef: store.get('damRef') || null,
      volRatio: volRatio(),
      shares: store.get('shares') || {},
      deCalc: store.get('deCalc') || {},
      width: Math.min(760, Math.max(320, ($('pasos') && $('pasos').clientWidth - 40) || 640)),
    };
  }
  const pasosHTML = (ctx) => PF.pasos.render(ctx) + PF.frontera.render(ctx) + PF.riesgo.render(ctx);
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
      } else if (t.dataset && t.dataset.de) {
        const all = store.get('deCalc') || {};
        all[t.dataset.de] = Object.assign({}, all[t.dataset.de], { [t.dataset.f]: t.value });
        store.set('deCalc', all);
        renderPasos();
        const el = $('paso-de');
        if (el) el.scrollIntoView({ block: 'nearest' });
      } else if (t.id === 'dam-crp') {
        // Vacío: vuelve a la prima calculada en Datos → Renta fija
        const v = parseFloat(String(t.value).replace(',', '.'));
        store.set('crp', Number.isFinite(v) ? v / 100 : null);
        store.set('crpManual', Number.isFinite(v));
        renderPasos();
      } else if (t.id === 'dam-file' && t.files && t.files[0]) {
        const file = t.files[0];
        file.arrayBuffer().then((buf) => loadDamodaran((X) => X.read(new Uint8Array(buf), { type: 'array' }), file.name));
      }
    });
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-de-use]');
      if (!b) return;
      const all = store.get('dam') || {};
      all[b.dataset.deUse] = Object.assign({}, all[b.dataset.deUse], { de: b.dataset.deVal });
      store.set('dam', all);
      renderPasos();
      const el = $('dam-panel');
      if (el) el.scrollIntoView({ block: 'start' });
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
      const from = libFrom();
      const keep = d.dates.map((t) => (!cut || t <= cut) && (!from || t >= from));
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
  /* Lector de PDF (pdf.js, desde cdnjs) para los boletines del DANE. */
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  let pdfjs = null;
  function loadPdfJS() {
    if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
    if (!pdfjs)
      pdfjs = new Promise((ok, ko) => {
        const sc = document.createElement('script');
        sc.src = PDFJS;
        sc.onload = () => {
          const L = globalThis.pdfjsLib;
          if (!L) return ko(new Error('El lector de PDF no se inicializó.'));
          L.GlobalWorkerOptions.workerSrc = PDFJS.replace('pdf.min.js', 'pdf.worker.min.js');
          ok(L);
        };
        sc.onerror = () => {
          pdfjs = null;
          ko(new Error('No se pudo cargar el lector de PDF (se necesita internet).'));
        };
        document.head.appendChild(sc);
      });
    return pdfjs;
  }
  async function pdfText(buf) {
    const L = await loadPdfJS();
    const doc = await L.getDocument({ data: new Uint8Array(buf) }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const c = await page.getTextContent();
      text += c.items.map((x) => x.str).join(' ') + '\n';
    }
    return text;
  }
  async function saveMacroPts(key, pts, source) {
    const d = { dates: pts.map((p) => p.date || p[0]), values: pts.map((p) => (p.value != null ? p.value : p[1])) };
    const added = await PF.lib.saveMacro(key, d, source);
    await refreshLib();
    renderMacro();
    return added;
  }
  function wireMacro() {
    let pending = null; // datos leídos de un PDF, en revisión
    $('macro-file').addEventListener('change', async (ev) => {
      const files = [...(ev.target.files || [])];
      if (!files.length) return;
      const key = $('macro-var').value;
      const V = PF.macro.VARS[key];
      $('macro-preview').hidden = true;
      try {
        for (const file of files) {
          const buf = await file.arrayBuffer();
          const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
          if (/^pdf$/i.test(ext)) {
            macroStatus(`Leyendo el PDF «${file.name}»…`);
            const found = PF.macro.parsePdfText(await pdfText(buf), key);
            if (!found.length) throw new Error(`En «${file.name}» no se encontró la cifra de ${V.long.toLowerCase()} (por ejemplo «En el segundo trimestre de 2025 … crece 2,1 %»). Prueba con el anexo en Excel del mismo boletín.`);
            pending = { key, found, source: 'Boletín en PDF: ' + file.name };
            $('macro-preview').hidden = false;
            $('macro-preview').innerHTML = `<h3>Datos encontrados en «${esc(file.name)}»</h3><p class="sub">Revisa cada cifra con la frase del boletín de donde salió, corrige si hace falta y guarda las que estén bien.</p>
              <div class="table-scroll"><table class="data"><thead><tr><th></th><th>Fecha</th><th class="n">${esc(V.long)}</th><th>Frase del boletín</th></tr></thead><tbody>${found
                .map((f, i) => `<tr><td><input type="checkbox" data-mp="${i}" checked aria-label="Guardar ${esc(f.date)}"></td><td>${esc(f.date.slice(0, 7))}</td><td class="n"><input class="cell" data-mv="${i}" value="${String(f.value).replace('.', ',')}" inputmode="decimal" aria-label="Valor de ${esc(f.date)}"></td><td class="sub">${esc(f.text)}</td></tr>`)
                .join('')}</tbody></table></div><div class="row-btns"><button type="button" class="btn btn-primary" id="macro-save">Guardar los datos marcados</button></div>`;
            macroStatus(`${found.length} dato(s) encontrados en el PDF: revísalos abajo y guárdalos.`, 'ok');
            continue;
          }
          let d;
          if (/^xlsx?$/i.test(ext)) {
            const X = await loadSheetJS();
            const wb = X.read(buf, { type: 'array', cellDates: true });
            let err = null;
            // Primero el formato del Banco de la República (elige la serie por su nombre); si no, fecha y valor
            for (const sh of wb.SheetNames) {
              const b = PF.macro.parseBanrep(X.utils.sheet_to_json(wb.Sheets[sh], { header: 1, raw: true }), key, file.name);
              if (b) {
                d = b;
                break;
              }
            }
            if (!d && key === 'trm' && wb.SheetNames.some((sh) => /tasa de cambio real/i.test(JSON.stringify(X.utils.sheet_to_json(wb.Sheets[sh], { header: 1 }).slice(0, 6))))) throw new Error(`«${file.name}» trae índices de tasa de cambio real (ITCR), no la TRM. Descarga del Banco de la República la serie «Tasa de cambio representativa del mercado (TRM)».`);
            for (const sh of d ? [] : wb.SheetNames) {
              try {
                d = PF.macro.parseRows(X.utils.sheet_to_json(wb.Sheets[sh], { header: 1, raw: true }), file.name);
                break;
              } catch (e) {
                err = e;
              }
            }
            if (!d) throw err || new Error(`«${file.name}» no tiene fechas y valores`);
          } else {
            let text;
            try {
              text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
            } catch (e) {
              text = new TextDecoder('windows-1252').decode(buf);
            }
            d = PF.macro.parseFile(text, file.name);
          }
          await PF.lib.saveMacro(key, d, d.label ? `Banco de la República · ${d.label} (${file.name})` : 'Archivo importado: ' + file.name);
          await refreshLib();
          macroStatus(`${V.long}: ${d.dates.length} datos de ${d.dates[0]} a ${d.dates[d.dates.length - 1]} (${file.name}${d.label ? `, serie «${d.label}»` : ''}).`, 'ok');
          renderMacro();
        }
      } catch (e) {
        macroStatus(e.message, 'bad');
      }
      ev.target.value = '';
    });
    $('macro-preview').addEventListener('click', async (ev) => {
      if (!ev.target.closest('#macro-save') || !pending) return;
      const pts = pending.found
        .map((f, i) => ({ date: f.date, value: PF.data.parseNumber($('macro-preview').querySelector(`[data-mv="${i}"]`).value, true), on: $('macro-preview').querySelector(`[data-mp="${i}"]`).checked }))
        .filter((p) => p.on && Number.isFinite(p.value));
      if (!pts.length) return macroStatus('No hay datos marcados para guardar.', 'bad');
      const added = await saveMacroPts(pending.key, pts, pending.source);
      macroStatus(`${PF.macro.VARS[pending.key].long}: ${added} dato(s) nuevos guardados del boletín (los ya guardados no cambian).`, 'ok');
      pending = null;
      $('macro-preview').hidden = true;
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
  /* ---------- Ventana emergente: composición de un portafolio y gráficas ampliadas ---------- */
  function openModal(html, wide) {
    const m = $('modal');
    $('modal-body').innerHTML = html;
    m.classList.toggle('wide', !!wide);
    m.hidden = false;
    $('tip').hidden = true;
    $('modal-close').focus();
  }
  function closeModal() {
    $('modal').hidden = true;
    $('modal-body').innerHTML = '';
  }
  // Portafolio por clave: front:<portafolio de referencia>, conf:me (el tuyo), conf:tangent
  function portByKey(key) {
    const [kind, k] = String(key).split(':');
    if (kind === 'front' && st.P && st.P[k]) {
      const def = PORTS.find((p) => p.key === k);
      return { title: def ? def.title : k, desc: def ? def.desc : '', e: st.P[k] };
    }
    if (kind === 'conf' && st.conf) {
      if (k === 'me') return { title: 'Tu portafolio', desc: 'Los pesos de las compras que registraste en Confirmar.', e: st.conf.me };
      if (k === 'tangent' && st.conf.tangency) return { title: 'Portafolio tangente (máxima razón de Sharpe)', desc: '', e: st.conf.tangency };
    }
    return null;
  }
  function portfolioHTML(p) {
    const m = st.model;
    const e = p.e;
    const cap = st.s && Number.isFinite(st.s.capital) ? st.s.capital : 0;
    const rows = m.names.map((n, i) => ({ n, w: e.w[i] })).filter((x) => Math.abs(x.w) > 5e-4).sort((a, b) => b.w - a.w);
    const max = Math.max(...rows.map((x) => Math.abs(x.w)), 1e-9);
    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    return `<h2 id="modal-title">${esc(p.title)}</h2>${p.desc ? `<p class="hint">${esc(p.desc)}</p>` : ''}
      <div class="modal-kv">${kv('Rendimiento esperado', pct(e.ret))}${kv('Riesgo σ', pct(e.vol))}${kv('Sharpe', num(e.sharpe))}${kv('β', num(e.beta))}${kv('Activos', rows.length)}${Number.isFinite(e.effN) ? kv('N efectivo', num(e.effN, 1)) : ''}</div>
      <div class="table-scroll"><table class="data comp"><thead><tr><th>Activo</th><th class="n">Peso</th><th></th>${cap ? '<th class="n">Monto</th>' : ''}</tr></thead><tbody>${rows
        .map((x) => `<tr><td>${esc(x.n)}</td><td class="n"><b>${pct(x.w)}</b></td><td class="barcell"><span class="bar" style="width:${Math.round((Math.abs(x.w) / max) * 100)}%"></span></td>${cap ? `<td class="n">${esc(money(cap * x.w))}</td>` : ''}</tr>`)
        .join('')}</tbody></table></div>
      ${cap ? `<p class="hint">Montos con el capital de Supuestos: ${esc(money(cap))}.</p>` : ''}`;
  }
  // Botón «Ampliar» en cada gráfica (también las que se dibujan después)
  function addZoomButtons() {
    document.querySelectorAll('.chart-box, .term-chart').forEach((box) => {
      if (!box.querySelector('svg') || box.querySelector(':scope > .zoom-btn')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'zoom-btn';
      b.setAttribute('aria-label', 'Ampliar la gráfica');
      b.title = 'Ampliar la gráfica';
      b.innerHTML = '⤢ Ampliar';
      box.appendChild(b);
    });
  }
  function zoomChart(box) {
    const fig = box.closest('figure, .panel');
    const cap = fig && fig.querySelector('figcaption h2, h2, h3');
    const clone = box.cloneNode(true);
    clone.querySelectorAll('.zoom-btn').forEach((x) => x.remove());
    clone.querySelectorAll('svg').forEach((svg) => {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = '100%';
      svg.style.height = 'auto';
    });
    const legend = fig && fig.querySelector('.legend');
    openModal(`<h2 id="modal-title">${esc(cap ? cap.textContent : 'Gráfica')}</h2>
      <div class="zoom-tools" role="group" aria-label="Tamaño"><button type="button" data-zoom="-1" aria-label="Reducir">−</button><span id="zoom-lvl">100 %</span><button type="button" data-zoom="1" aria-label="Ampliar">+</button></div>
      <div class="zoom-stage"><div class="zoom-inner" style="width:100%">${clone.innerHTML}</div></div>${legend ? `<div class="legend">${legend.innerHTML}</div>` : ''}
      <p class="hint">Pasa el puntero sobre los puntos para ver sus datos; en un portafolio, haz clic para ver su composición.</p>`, true);
  }
  function wireModal() {
    $('modal-close').addEventListener('click', closeModal);
    $('modal').addEventListener('click', (ev) => {
      if (ev.target === $('modal')) closeModal();
      const z = ev.target.closest('[data-zoom]');
      if (z) {
        const inner = $('modal-body').querySelector('.zoom-inner');
        const cur = parseInt(inner.style.width, 10) || 100;
        const next = Math.max(100, Math.min(250, cur + 25 * +z.dataset.zoom));
        inner.style.width = next + '%';
        $('zoom-lvl').textContent = next + ' %';
      }
    });
    document.addEventListener('keydown', (ev) => ev.key === 'Escape' && !$('modal').hidden && closeModal());
    document.addEventListener('click', (ev) => {
      const zb = ev.target.closest('.zoom-btn');
      if (zb) return zoomChart(zb.parentElement);
      const pt = ev.target.closest('[data-port]');
      if (!pt) return;
      const p = portByKey(pt.getAttribute('data-port'));
      if (p && st.model) openModal(portfolioHTML(p));
    });
    new MutationObserver(debounce(addZoomButtons, 120)).observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
  }

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
    // Frecuencia fija: diaria (una ajustada guardada por una versión anterior no se usa)
    $('freq').value = 'diaria';
    $('agg').value = 'last';
    $('rettype').value = 'log'; // rendimientos siempre logarítmicos
    const savedCsv = store.get('csv');
    let dailyCsv = false;
    try {
      dailyCsv = !!savedCsv && isDaily(PF.data.parseCSV(savedCsv).dates);
    } catch (e) {
      dailyCsv = false;
    }
    // Sin datos hasta que el usuario sube sus archivos (o pide el ejemplo simulado)
    $('csv').value = dailyCsv ? savedCsv : '';

    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.getAttribute('data-go'))));
    // Flechas para desplazar la barra de menús cuando no cabe completa
    const nav = document.querySelector('.tabs');
    const arrows = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      $('tabs-left').hidden = max <= 2 || nav.scrollLeft <= 2;
      $('tabs-right').hidden = max <= 2 || nav.scrollLeft >= max - 2;
    };
    $('tabs-left').addEventListener('click', () => nav.scrollBy({ left: -Math.max(160, nav.clientWidth * 0.6) }));
    $('tabs-right').addEventListener('click', () => nav.scrollBy({ left: Math.max(160, nav.clientWidth * 0.6) }));
    nav.addEventListener('scroll', arrows, { passive: true });
    window.addEventListener('resize', arrows);
    setTimeout(arrows, 0);
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
      $('csv').value = PF.sample.csv(0, { daily: true });
      $('kind').value = 'prices';
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
    wireRf();
    wireModal();
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
    for (const k of ['xlsx', 'cov', 'corr', 'ret', 'stats', 'ports', 'desv', 'pond', 'front', 'cml', 'sml', 'elec', 'corrp', 'contrib', 'macro', 'pasos', 'macrodoc']) $('dl-' + k).addEventListener('click', () => doDownload(k));
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
    // La posición de cada pestaña se guarda mientras se desplaza (y al cerrar la app)
    window.addEventListener('scroll', debounce(saveScroll, 300), { passive: true });
    window.addEventListener('pagehide', saveScroll);
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
      // Las variables que vienen del Banco de la República no se mezclan con otras fuentes
      const fromBanrep = (k) => st.lib && st.lib.macro && st.lib.macro[k] && /^(Banco de la República|Superintendencia Financiera)/.test(st.lib.macro[k].source || '');
      for (const [k, d] of Object.entries(data || {})) if (d && d.dates && !fromBanrep(k)) await PF.lib.saveMacro(k, d, d.source);
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
