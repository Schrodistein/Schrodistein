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

  const st = { parsed: null, model: null, P: null, sel: 'tangency', userW: null, userNames: null, sort: { key: null, dir: -1 }, screen: 'terminal', err: null, mode: 'pesos', buys: {}, buyTotal: 0 };

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
      fee: Math.max(0, val('fee') ?? 0),
      retType: $('rettype').value,
      agg: $('agg').value,
      history: $('history').value,
    };
  }
  const SETTING_IDS = ['kind', 'freq', 'rettype', 'agg', 'history', 'rf', 'em', 'mumodel', 'covmodel', 'wmin', 'wmax', 'capital', 'fee', 'currency', 'tol'];

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
      const R = PF.data.toReturns(p.values, s.kind, s.retType === 'log');
      const mi = s.market;
      const names = p.names.filter((_, i) => i !== mi);
      const n = names.length;
      if (s.wmax * n < 1 - 1e-9) {
        warnings.push(`Con ${n} activos un peso máximo de ${nf1(s.wmax * 100)} % no alcanza para sumar 100 %; se usa ${nf1(100 / n)} %, que obliga a pesos iguales. Sube el peso máximo o agrega activos.`);
        s.wmax = 1 / n;
      }
      else if (s.wmax * n < 1 + 1e-6 && s.wmin <= 0) {
        warnings.push(`Con ${n} activos y un peso máximo de ${nf1(s.wmax * 100)} %, todos los portafolios quedan en pesos iguales (1/N) y la frontera se reduce a un punto. Sube el peso máximo en Datos (por ejemplo a ${nf1(Math.min(100, Math.ceil((150 / n) / 5) * 5))} %) o agrega más acciones.`);
      }
      if (s.wmin * n > 1 + 1e-9) throw new Error(`Con ${n} activos el peso mínimo no puede pasar de ${nf1(100 / n)} %.`);
      if (s.wmin > s.wmax) throw new Error('El peso mínimo es mayor que el máximo.');
      const datos = { names, returns: R.filter((_, i) => i !== mi), market: R[mi], marketName: p.names[mi], dates: p.dates };
      const m = PF.model.build(datos, { freq: s.freq, rf: s.rf, muModel: s.muModel, covModel: s.covModel, marketReturn: s.marketReturn, history: s.history });
      if (!PF.data.isMarketName(p.names[mi])) warnings.push(`No se encontró un índice de mercado (COLCAP o ICOLCAP) entre los datos; se está usando «${p.names[mi]}» como mercado, así que las β, Treynor y Jensen no son las del mercado. Sube también el histórico del índice MSCI COLCAP o del ETF ICOLCAP, o elige el índice en «Índice de mercado».`);
      if (st.lagNote && st.series && $('csv').value === st.mergedText) warnings.push(st.lagNote);
      const inf = m.info;
      if (m.singular) warnings.push('Hay menos periodos comunes que activos: la covarianza muestral es singular. Elige «Toda la historia de cada activo» o el modelo de índice único de Sharpe.');
      else if (inf.pairwise) {
        const short = names.map((nm, i) => [nm, inf.counts[i]]).filter((x) => x[1] < 0.8 * Math.max(...inf.counts));
        if (short.length) warnings.push(`Historias de distinta longitud: ${short.map((x) => `${x[0]} (${x[1]} periodos)`).join(', ')} frente a ${Math.max(...inf.counts)} del activo más largo. Cada activo usa toda su historia y cada correlación, las fechas que comparten los dos.${inf.psdFixed ? ' La matriz de correlación se ajustó para que fuera válida.' : ''}`);
        if (m.Teff < 36) warnings.push(`La mayoría de los activos tiene ${m.Teff} periodos; con menos de 36 las estimaciones son inestables.`);
      } else if (m.T < 36) warnings.push(`Solo hay ${m.T} periodos en que todos los activos tienen dato. Con menos de 36 las estimaciones son muy inestables.`);
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
        renderBuyInputs();
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
    if (combined.length < 2) {
      status(`Solo se encontró el historial de ${combined[0].name}. Sube a la vez los archivos de todas tus acciones y del índice de mercado (por ejemplo el COLCAP).${allErr ? ' Además: ' + allErr : ''}`, 'bad');
      return;
    }
    st.series = combined;
    const plan = suggestSettings(combined);
    if (mergeLoaded(false)) status(`Listo: ${combined.length} activos cargados de ${files.length - errors.length} archivos. ${plan}${allErr ? ' No se pudieron leer: ' + allErr : ''}`, allErr ? 'warn' : 'ok');
  }

  /* Frecuencia y agregación sugeridas para historiales recién cargados.
   * Diarios bien fechados: semanal con último cierre (más observaciones que mensual y menos
   * sesgo por acciones que no negocian todos los días). Si hay series desfasadas: mensual
   * con promedio del periodo, que amortigua el desfase. */
  function suggestSettings(list) {
    const capNote = suggestCap(list.length - 1);
    return (suggestFreq(list) + ' ' + capNote).trim();
  }
  /* Peso máximo que deja optimizar: con n activos, al menos 1,5 / n (redondeado a 5 %). */
  function suggestCap(n) {
    const wmax = (val('wmax') ?? 100) / 100;
    if (n < 2 || n * wmax >= 1.5) return '';
    const cap = Math.min(100, Math.ceil(150 / n / 5) * 5);
    $('wmax').value = cap;
    return `Con ${n} activos el peso máximo por activo pasa a ${cap} % para que el portafolio se pueda optimizar sin dejar de diversificar.`;
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
      const merged = PF.data.mergeSeries(st.series, freq, { agg: $('agg').value });
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
        (noTrade ? ` Se omitieron ${noTrade} días sin negociación (precio de referencia sin cantidad negociada).` : '');
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
      st.series = combined;
      if (mergeLoaded(false)) status(`Listo: ${combined.length} activos leídos del texto pegado.`, 'ok');
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
    return st.P.tangency || st.P.maxDiv;
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
        return `<div class="brow"><span class="bname">${esc(n)}</span>` +
          `<input id="bq-${i}" data-bq="${i}" type="number" min="0" step="1" inputmode="numeric" placeholder="Acciones" aria-label="Acciones de ${esc(n)}" value="${b.qty != null ? esc(b.qty) : ''}">` +
          `<input id="bd-${i}" data-bd="${i}" type="date" aria-label="Fecha de compra de ${esc(n)}" value="${esc(b.date || $('buy-date').value || '')}">` +
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
      const amount = ok ? qty * hit.price : 0;
      const lastP = ser.prices.at(-1);
      const lastD = ser.dates.at(-1);
      return { n, i, qty, date, hit, ok, amount, lastP, lastD, value: ok ? qty * lastP : 0 };
    });
    const total = rows.reduce((q, r) => q + r.amount, 0);
    const value = rows.reduce((q, r) => q + r.value, 0);
    const fee = st.s ? st.s.fee : 0;
    const nBuys = rows.filter((r) => r.ok && r.qty > 0).length;
    const buyFees = nBuys * fee;
    st.buyTotal = total;
    rows.forEach((r) => {
      const el = $('bn-' + r.i);
      if (!el) return;
      el.className = 'bnote' + (r.hit && r.hit.error ? ' bad' : '');
      el.textContent = !r.qty
        ? ''
        : r.hit.error
          ? r.hit.error
          : `Cierre del ${r.hit.date}${r.hit.exact ? '' : r.hit.after ? ' (último dato disponible)' : ' (ese día no hubo negociación)'}: ${money(r.hit.price)} × ${r.qty} = ${money(r.amount)}`;
    });
    $('buy-sum').textContent = total > 0 ? `Total invertido: ${money(total)}${buyFees ? ` + comisiones ${money(buyFees)} = ${money(total + buyFees)}` : ''}` : '';
    const has = rows.filter((r) => r.ok);
    $('buy-detail').hidden = !has.length;
    if (has.length) {
      const pctc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + pct(x) : '—');
      $('buy-table').innerHTML =
        '<thead><tr><th>Activo</th><th class="n">Acciones</th><th>Fecha de compra</th><th>Cierre usado</th><th class="n">Precio de compra</th><th class="n">Invertido</th><th class="n">Peso</th><th>Último cierre</th><th class="n">Precio</th><th class="n">Valor hoy</th><th class="n">Ganancia</th></tr></thead><tbody>' +
        has.map((r) => `<tr><td>${esc(r.n)}</td><td class="n">${r.qty.toLocaleString('es-CO')}</td><td>${esc(r.date)}</td><td>${esc(r.hit.date)}${r.hit.exact ? '' : ' *'}</td><td class="n">${money(r.hit.price)}</td><td class="n">${money(r.amount)}</td><td class="n">${pct(r.amount / total)}</td><td>${esc(r.lastD)}</td><td class="n">${money(r.lastP)}</td><td class="n">${money(r.value)}</td><td class="n ${r.value >= r.amount ? 'pos' : 'neg'}">${pctc(r.value / r.amount - 1)}</td></tr>`).join('') +
        `<tr class="hl"><td>Total</td><td></td><td></td><td></td><td></td><td class="n">${money(total)}</td><td class="n">${pct(1)}</td><td></td><td></td><td class="n">${money(value)}</td><td class="n ${value >= total ? 'pos' : 'neg'}">${pctc(value / total - 1)}</td></tr>` +
        (fee
          ? `<tr><td colspan="5">Comisiones de compra (${nBuys} × ${money(fee)})</td><td class="n">${money(buyFees)}</td><td colspan="3"></td><td class="n">Si vendes hoy: −${money(buyFees)}</td><td></td></tr>` +
            `<tr class="hl"><td colspan="5"><b>Costo total con comisiones</b></td><td class="n"><b>${money(total + buyFees)}</b></td><td colspan="3"><b>Neto si vendes hoy (menos comisiones de compra y venta)</b></td><td class="n"><b>${money(value - buyFees)}</b></td><td class="n ${value - buyFees >= total + buyFees ? 'pos' : 'neg'}"><b>${pctc((value - buyFees) / (total + buyFees) - 1)}</b></td></tr>`
          : '') +
        '</tbody>';
      const notes = [];
      if (has.some((r) => !r.hit.exact && !r.hit.after)) notes.push('* Ese día no hubo negociación del activo; se usó el último cierre anterior.');
      if (has.some((r) => r.hit.after)) notes.push('Alguna fecha es posterior al último dato cargado; se usó el último cierre disponible.');
      if (has.some((r) => !priceSeries(r.n).daily)) notes.push('Los precios salen de la tabla agrupada por periodo; para el cierre exacto de un día, carga los CSV diarios de la BVC.');
      notes.push(`La ganancia por activo no incluye dividendos ni comisiones; la fila «Neto si vendes hoy» descuenta ${fee ? `${money(fee)} por cada compra y cada venta` : 'las comisiones (hoy en $0; cámbialas en Datos)'}. Los pesos del portafolio salen del monto invertido en cada activo.`);
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

  function renderPlan() {
    const m = st.model;
    if (!m) return;
    if (document.activeElement !== $('plan-budget')) $('plan-budget').value = st.s.capital;
    if (document.activeElement !== $('plan-fee')) $('plan-fee').value = st.s.fee;
    const key = $('plan-base').value;
    const base = st.P[key] || rec();
    const lp = lastPrices();
    const res = PF.plan.recommend(m, base.w, lp.map((x) => x.price), st.s.capital, st.s.fee, { optimizeK: $('plan-optk').checked && key === 'tangency', hi: st.s.wmax });
    const best = res.best;
    const plan = best.plan;
    st.plan = null;
    if (!plan.rows.length) {
      $('plan-out').innerHTML = `<h2>Sin plan</h2><p>${esc(plan.error || 'El presupuesto no alcanza para comprar acciones con estas comisiones.')}</p>`;
      $('plan-alt').innerHTML = '';
      return;
    }
    plan.rows.forEach((r) => (r.date = lp[m.names.indexOf(r.name)].date));
    const ev = best.ev;
    st.plan = { plan, ev, label: best.label };
    const names = plan.rows.map((r) => r.name);
    const changed = best !== res.full && res.full.plan.k !== plan.k;
    const fullNote = changed && res.full.ev
      ? `<p class="hint">Con ${money(plan.budget)} y ${money(plan.fee)} por operación conviene comprar ${plan.k} ${plan.k === 1 ? 'activo' : 'activos'} en lugar de ${res.full.plan.k}: la razón de Sharpe neta sube de ${num(res.full.ev.netSharpe)} a ${num(ev.netSharpe)}. Desmarca la casilla de arriba para ver el plan con todos los activos.</p>`
      : '';
    const dates = [...new Set(plan.rows.map((r) => r.date))];
    $('plan-out').innerHTML = `
      <p class="plan-lead">Compra <b>${plan.rows.map((r) => `${r.shares.toLocaleString('es-CO')} ${esc(r.name)}`).join(', ')}</b>, por ${money(plan.invested)} más ${money(plan.buyFees)} de comisiones.</p>
      <div class="tiles">
        ${tile('Invertido en acciones', money(plan.invested), `${plan.k} ${plan.k === 1 ? 'activo' : 'activos'}`)}
        ${tile('Comisiones de compra', money(plan.buyFees), `${plan.k} × ${money(plan.fee)}`)}
        ${tile('Comisiones de venta (futuras)', money(plan.sellFees), 'al vender todo')}
        ${tile('Efectivo sin invertir', money(plan.cash), 'no alcanza para otra acción')}
        ${tile('Rendimiento esperado del portafolio', pct(ev.e.ret), 'anual, antes de comisiones')}
        ${tile('Rendimiento neto sobre el presupuesto', pct(ev.netRet), 'descontando compra y venta')}
        ${tile('Ganancia esperada neta', money(ev.netGain), 'en un año')}
        ${tile('Mínimo para cubrir comisiones', pct(ev.breakEven), 'de rendimiento sobre lo invertido')}
      </div>
      <div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th class="n">Peso objetivo</th><th class="n">Último cierre</th><th>Fecha</th><th class="n">Acciones</th><th class="n">Monto</th><th class="n">Peso real</th><th class="n">Comisión de compra</th></tr></thead><tbody>
        ${plan.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${pct(r.w)}</td><td class="n">${money(r.price)}</td><td>${esc(r.date || '')}</td><td class="n"><b>${r.shares.toLocaleString('es-CO')}</b></td><td class="n">${money(r.amount)}</td><td class="n">${pct(r.realW)}</td><td class="n">${money(plan.fee)}</td></tr>`).join('')}
        <tr class="hl"><td>Total</td><td></td><td></td><td></td><td></td><td class="n">${money(plan.invested)}</td><td class="n">${pct(1)}</td><td class="n">${money(plan.buyFees)}</td></tr>
      </tbody></table></div>
      ${fullNote}
      <p class="hint">Precios: último cierre de los datos cargados (${esc(dates.join(', '))}); el precio al comprar será distinto. El portafolio se calcula solo con los ${m.names.length} activos cargados (${esc(m.names.join(', '))}) y ${esc(m.marketName)} como índice de referencia. ${names.length < m.names.length ? `Quedan fuera: ${esc(m.names.filter((n) => !names.includes(n)).join(', '))}.` : ''}</p>
      <div class="row-btns"><button type="button" class="btn btn-primary" id="plan-register">Registrar esta compra en Confirmar</button></div>`;
    const tries = res.tries.filter((t) => t.ev);
    $('plan-alt-box').hidden = tries.length < 2;
    $('plan-alt').innerHTML =
      '<thead><tr><th>Alternativa</th><th class="n">Activos</th><th>Composición</th><th class="n">Invertido</th><th class="n">Comisiones (compra + venta)</th><th class="n">E(R) bruto</th><th class="n">Rendimiento neto</th><th class="n">Sharpe neto</th></tr></thead><tbody>' +
      tries
        .map((t) => `<tr${t === best ? ' class="hl"' : ''}><td>${esc(t.label)}${t === best ? ' (elegida)' : ''}</td><td class="n">${t.plan.k}</td><td>${esc(t.plan.rows.map((r) => `${r.name} ${pct(r.realW, 0)}`).join(', '))}</td><td class="n">${money(t.plan.invested)}</td><td class="n">${money(t.plan.buyFees + t.plan.sellFees)}</td><td class="n">${pct(t.ev.e.ret)}</td><td class="n">${pct(t.ev.netRet)}</td><td class="n">${num(t.ev.netSharpe)}</td></tr>`)
        .join('') +
      '</tbody>';
  }

  function registerPlan() {
    if (!st.plan) return;
    st.buys = {};
    // Datos mensuales («AAAA-MM»): el campo de fecha necesita un día; se usa el 1.
    const day = (d) => (/^\d{4}-\d{2}$/.test(d || '') ? d + '-01' : d);
    for (const r of st.plan.plan.rows) st.buys[r.name] = { qty: String(r.shares), date: day(r.date) };
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
  const csvNum = (x) => (Number.isFinite(x) ? String(+x.toPrecision(12)).replace('.', ',') : '');
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
    if (st.plan) extra.push({ label: `Plan de compra (${st.plan.plan.k} activos, pesos reales)`, w: st.plan.ev.w });
    return { m, P: st.P, table: st.parsed, marketIdx: st.s.market, s: Object.assign({}, st.s, { marketReturnSet: st.s.marketReturn != null }), extra, plan: st.plan && st.plan.plan, generated: stamp() };
  }

  function doDownload(kind) {
    if (!st.model) return dlStatus('Primero carga datos en la sección Datos.', 'bad');
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
        rows = [['Activo', 'Peso objetivo', 'Precio', 'Fecha del precio', 'Acciones', 'Monto', 'Peso real', 'Comisión de compra']].concat(pl.rows.map((r) => [r.name, r.w, r.price, r.date || '', r.shares, r.amount, r.realW, pl.fee]), [
          [],
          ['Presupuesto', pl.budget],
          ['Invertido', pl.invested],
          ['Comisiones de compra', pl.buyFees],
          ['Comisiones de venta', pl.sellFees],
          ['Efectivo sin invertir', pl.cash],
          ['Rendimiento esperado', st.plan.ev.e.ret],
          ['Rendimiento neto sobre el presupuesto', st.plan.ev.netRet],
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
    if (!document.getElementById('screen-' + screen)) screen = 'terminal';
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
    $('agg').addEventListener('change', () => {
      if (st.series && $('csv').value === st.mergedText) mergeLoaded(true);
    });
    for (const id of ['rettype', 'history']) $(id).addEventListener('change', compute);
    $('freq').addEventListener('change', () => {
      // Con historiales diarios subidos, se reagrupan a la nueva frecuencia.
      if (st.series && $('csv').value === st.mergedText) mergeLoaded(true);
      else compute();
    });
    $('currency').addEventListener('change', () => {
      store.set('settings', Object.fromEntries(SETTING_IDS.map((id) => [id, $(id).value])));
      if (st.model) render();
    });
    for (const id of ['rf', 'em', 'wmin', 'wmax', 'capital', 'fee']) $(id).addEventListener('input', recompute);
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
      if (b != null) $('capital').value = b;
      if (f != null) $('fee').value = f;
      compute();
    }, 350);
    $('plan-budget').addEventListener('input', planSync);
    $('plan-fee').addEventListener('input', planSync);
    $('plan-base').addEventListener('change', renderPlan);
    $('plan-optk').addEventListener('change', renderPlan);
    $('plan-out').addEventListener('click', (ev) => ev.target.closest('#plan-register') && registerPlan());
    for (const k of ['xlsx', 'cov', 'corr', 'ret', 'stats', 'ports', 'plan']) $('dl-' + k).addEventListener('click', () => doDownload(k));
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
      const i = q ?? d;
      if (i == null) return;
      const n = st.userNames[+i];
      st.buys[n] = Object.assign({}, st.buys[n], q != null ? { qty: ev.target.value } : { date: ev.target.value });
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
    st.screen = document.getElementById('screen-' + hash) ? hash : 'terminal';
    parse(false);
    go(st.screen);
  }

  /* Punto de entrada para la app de escritorio (js/desktop.js): carga historiales
   * ya descargados como si se hubieran subido archivos. */
  globalThis.PFApp = {
    loadSeries(list, origin) {
      const combined = PF.data.combineSeries(list);
      if (combined.length < 2) {
        status('Se necesitan al menos dos activos con datos para el análisis.', 'bad');
        return false;
      }
      st.series = combined;
      const plan = suggestSettings(combined);
      const ok = mergeLoaded(false);
      if (ok) status(`Listo: ${combined.length} activos cargados ${origin || ''}. ${plan}`.trim(), 'ok');
      return ok;
    },
    go,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
