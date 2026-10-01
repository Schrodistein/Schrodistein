/* Interfaz de Radar de Divisas: datos en directo, señales, avisos,
 * escáner, proyección, backtest y calculadora de riesgo. */
(function () {
  'use strict';
  const { util: U, signals: SG, backtest: BT, risk: RK, binance: API, stats: ST, feeds: FEEDS, forex: F } = FX;

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const ok = Number.isFinite;
  const nf = (x, d) => (ok(x) ? x.toFixed(d == null ? 2 : d) : '—');
  const pct = (x, d) => (ok(x) ? (x > 0 ? '+' : '') + x.toFixed(d == null ? 2 : d) + ' %' : '—');
  const ppc = (p, d) => (ok(p) ? (p * 100).toFixed(d == null ? 0 : d) + ' %' : '—');
  const fp = (x, d) => U.fmtPrice(x, d == null ? state.dec : d);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const IV = { '1m': '1 min', '3m': '3 min', '5m': '5 min', '15m': '15 min', '30m': '30 min', '1h': '1 h', '2h': '2 h', '4h': '4 h', '6h': '6 h', '8h': '8 h', '12h': '12 h', '1d': '1 día', '3d': '3 días', '1w': '1 semana' };
  const dirWord = (d) => (d > 0 ? 'COMPRA' : d < 0 ? 'VENTA' : 'ESPERAR');
  const DT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const TM = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const when = (t) => DT.format(new Date(t));

  const store = {
    get(k, def) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* almacenamiento no disponible */
      }
    },
  };

  /* ---------- Ajustes ---------- */
  const DEFAULT_WATCH = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'EURUSDT', 'PAXGUSDT', 'BTCUSDT'];
  const DEFAULT_LAYERS = { ema: true, bb: false, ich: false, levels: true, fib: false, proj: true };
  const saved = store.get('fx.settings', {});
  const settings = Object.assign(
    {
      symbol: 'EUR/USD', interval: '1d', profile: 'equilibrado', market: 'spot', trendFilter: true, mtfFilter: false, tdKey: '', account: 'USD',
      rr: 2, atrStop: 1.5, capital: 1000, riskPct: 1, fee: 0.1, fxFee: 0.01, horizon: 24, sound: true, lower: 'rsi',
      scanOn: true, scanInterval: '1h', watch: DEFAULT_WATCH.slice(), tab: 'signals',
      uniMode: 'majors+usd', uniBinance: true, sigFilter: { dir: 'all', status: 'activa', market: 'all' },
    },
    saved
  );
  settings.layers = Object.assign({}, DEFAULT_LAYERS, saved.layers || {});
  const save = () => store.set('fx.settings', settings);
  const futures = () => settings.market === 'futures';
  // En divisas siempre se puede vender en corto (con un bróker de forex).
  const sigOpts = (dec, sym) => ({
    profile: settings.profile, trendFilter: settings.trendFilter, mtfFilter: settings.mtfFilter,
    rr: settings.rr, atrStop: settings.atrStop, allowShort: futures() || F.isForex(sym || settings.symbol), decimals: dec == null ? state.dec : dec,
  });
  // Coste por lado: comisión de Binance o diferencial (spread) del bróker de divisas.
  const feeFor = (sym) => (F.isForex(sym || settings.symbol) ? settings.fxFee : settings.fee);

  const state = {
    candles: [], ctx: null, evals: [], evalFrom: 0, cur: null, markers: [], proj: null, info: null, dec: 4,
    stream: null, pollTimer: null, demoTimer: null, demo: false, token: 0, lastTick: 0, ticker: null, sentiment: null,
    alerts: store.get('fx.alerts', []), alertKeys: new Set(store.get('fx.alertKeys', [])), unseen: 0,
    scan: {}, scanning: false, scanTimer: null, scanNext: 0, tab: settings.tab, lightTimer: null,
    feed: null, rates: store.get('fx.rates', null), calendar: null, calendarErr: null, ecbSeries: null, ecbErr: null,
    board: store.get('fx.board', []), news: null, newsAt: 0,
    uni: { series: null, binSymbols: null, binUsd: null, binHist: {}, tdPairs: null, index: null, results: [], running: false, loading: false, progress: [0, 0], at: 0, resultsAt: 0, err: {}, focus: null, sort: { key: 'opp', dir: -1 }, idxSort: { key: 'strength', dir: -1 } },
  };
  const UNI = FX.universe;
  const isFx = () => F.isForex(settings.symbol);
  const feedFor = (sym) => FEEDS.pick(sym, { tdKey: settings.tdKey });

  const chart = new FX.Chart($('#chart'));
  chart.lower = settings.lower;
  chart.show = Object.assign({}, settings.layers);
  if (chart.W < 600) chart.visible = 55;

  /* ---------- Estado de conexión ---------- */
  function setConn(s, text) {
    const el = $('#conn');
    el.dataset.state = s;
    $('span', el).textContent = text;
  }

  /* ---------- Carga del par ---------- */
  function stopLive() {
    if (state.stream) state.stream.close();
    state.stream = null;
    clearInterval(state.pollTimer);
    clearInterval(state.demoTimer);
    state.pollTimer = state.demoTimer = null;
  }

  const normalizeSymbol = (s) => F.normalize(s).symbol;

  // Temporalidades que admite la fuente: las demás se desactivan en el selector.
  function syncIntervals(feed) {
    $$('#interval option').forEach((o) => (o.disabled = !!feed && !feed.intervals.includes(o.value)));
  }

  async function load() {
    const token = ++state.token;
    stopLive();
    state.demo = false;
    state.ticker = null;
    state.sentiment = null;
    $('#load-error').hidden = true;
    $('#q-sym').textContent = settings.symbol;
    const feed = feedFor(settings.symbol);
    state.feed = feed;
    syncIntervals(feed);
    if (!feed) {
      showLoadError(new Error(`${settings.symbol} no está entre los tipos del BCE. Para analizarlo (y para tener velas intradía en cualquier par de divisas u oro) añade una clave gratuita de Twelve Data en Ajustes.`));
      return;
    }
    if (!feed.intervals.includes(settings.interval)) {
      const iv = feed.intervals.includes('1d') ? '1d' : feed.intervals[0];
      toast('Temporalidad ajustada', ` ${feed.label} solo ofrece datos ${feed.id === 'ecb' ? 'diarios y semanales' : 'en otras temporalidades'}: se usa ${IV[iv]}.${feed.id === 'ecb' ? ' Para velas intradía de divisas añade una clave gratuita de Twelve Data en Ajustes.' : ''}`, 0);
      settings.interval = iv;
      $('#interval').value = iv;
      save();
    }
    setConn('connecting', 'Cargando de ' + feed.label + '…');
    chart.set({ message: 'Cargando ' + settings.symbol + '…' });
    try {
      const [info, kl] = await Promise.all([
        feed.info(settings.symbol).catch((e) => {
          if (e.code === -1121) throw e;
          return null;
        }),
        feed.klines(settings.symbol, settings.interval, 1000),
      ]);
      if (token !== state.token) return;
      if (!kl.length) throw new Error(feed.label + ' no devolvió velas para este par.');
      state.info = info;
      state.dec = info && info.decimals != null ? info.decimals : U.autoDecimals(kl[kl.length - 1].c);
      state.candles = kl;
      state.lastTick = Date.now();
      recompute({ full: true });
      startLive(token);
      refreshTicker(token);
      refreshSentiment(token);
    } catch (e) {
      if (token !== state.token) return;
      showLoadError(e);
    }
  }

  function showLoadError(e) {
    setConn('error', 'Sin datos');
    const box = $('#load-error');
    box.hidden = false;
    box.innerHTML = `<strong>No se pudieron cargar los datos.</strong> ${esc(e.message || e)}<div class="row"><button class="btn small" type="button" id="retry">Reintentar</button><button class="btn small" type="button" id="demo">Probar con datos simulados</button></div>`;
    $('#retry').onclick = load;
    $('#demo').onclick = startDemo;
    chart.set({ message: 'Sin datos' });
    $('#signal').innerHTML = '<p class="muted">Sin datos para analizar.</p>';
  }

  function hashSeed(s) {
    let h = 2166136261;
    for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }

  // Modo demostración: mercado sintético con la vela en curso moviéndose en directo.
  function demoCandles(sym, interval, n) {
    const step = U.INTERVALS[interval];
    const now = Date.now();
    const start = /JPY$/.test(sym) ? 150 : /^XAU/.test(sym) ? 2400 : F.isForex(sym) || /^(EUR|GBP|AUD)/.test(sym) ? 1.1 : 100;
    const vol = (F.isForex(sym) ? 0.0015 : 0.004) * Math.sqrt(step / 3600e3);
    const C = U.synthetic(n, { seed: hashSeed(sym + interval), intervalMs: step, end: now, start, vol });
    const last = C[C.length - 1];
    C.push({ t: last.t + step, o: last.c, h: last.c, l: last.c, c: last.c, v: 0, T: last.t + 2 * step - 1, closed: false });
    return C;
  }

  function startDemo() {
    const token = ++state.token;
    stopLive();
    state.demo = true;
    state.info = null;
    state.ticker = null;
    state.sentiment = null;
    $('#load-error').hidden = true;
    state.candles = demoCandles(settings.symbol, settings.interval, 1000);
    state.dec = U.autoDecimals(state.candles[state.candles.length - 1].c);
    setConn('demo', 'Datos simulados');
    recompute({ full: true });
    const R = U.rng(hashSeed(settings.symbol) ^ Date.now());
    state.demoTimer = setInterval(() => {
      if (token !== state.token) return;
      const C = state.candles;
      const k = Object.assign({}, C[C.length - 1]);
      const step = U.INTERVALS[settings.interval];
      const vol = 0.0006 * Math.sqrt(step / 3600e3);
      k.c *= Math.exp(vol * R.normal());
      k.h = Math.max(k.h, k.c);
      k.l = Math.min(k.l, k.c);
      k.v += 50 * R();
      if (Date.now() > k.T) {
        k.closed = true;
        onKline(k);
        onKline({ t: k.T + 1, o: k.c, h: k.c, l: k.c, c: k.c, v: 0, T: k.T + step, closed: false });
      } else onKline(k);
    }, 1500);
  }

  function startLive(token) {
    let retried = false;
    const feed = state.feed;
    state.stream = feed.stream(settings.symbol, settings.interval, onKline, (s) => {
      if (token !== state.token) return;
      if (s === 'poll') setConn('poll', feed.id === 'ecb' ? 'BCE · fijación diaria' : F.marketOpen(new Date()) ? feed.label + ' · sondeo periódico' : 'Mercado de divisas cerrado');
      else if (s === 'live') {
        setConn('live', 'En directo');
        if (retried) {
          retried = false;
          resync();
        }
      } else if (s === 'retry') {
        retried = true;
        setConn('retry', 'Reconectando…');
      } else setConn('connecting', 'Conectando…');
    });
    if (!feed.live) return;
    // Red de seguridad (Binance): si el flujo calla, se piden las velas por REST.
    state.pollTimer = setInterval(() => {
      if (token !== state.token) return;
      if (Date.now() - state.lastTick > 45000) {
        if (!state.stream) setConn('poll', 'Actualizando cada 30 s');
        resync();
      }
      refreshTicker(token);
    }, 30000);
  }

  async function resync() {
    if (state.demo) return;
    const token = state.token;
    try {
      const kl = await state.feed.klines(settings.symbol, settings.interval, 1000);
      if (token !== state.token || !kl.length) return;
      const prevClosed = state.cur ? state.cur.t : 0;
      state.candles = kl;
      state.lastTick = Date.now();
      const li = U.lastClosed(kl);
      recompute({ full: true, alert: li >= 0 && kl[li].t > prevClosed });
    } catch (e) {
      setConn('error', 'Sin conexión');
    }
  }

  function onKline(k) {
    state.lastTick = Date.now();
    const C = state.candles;
    if (!C.length) return;
    const last = C[C.length - 1];
    let closedNow = false;
    if (k.t === last.t) {
      closedNow = k.closed && last.closed === false;
      C[C.length - 1] = k;
    } else if (k.t > last.t) {
      if (last.closed === false) {
        last.closed = true;
        closedNow = true;
      }
      C.push(k);
      closedNow = closedNow || k.closed;
      if (C.length > 1200) C.splice(0, C.length - 1000);
    } else return;
    if (closedNow) recompute({ full: true, alert: true });
    else scheduleLight();
  }

  // Vela en curso: se actualizan gráfico y precio como mucho una vez por segundo.
  function scheduleLight() {
    if (state.lightTimer) return;
    state.lightTimer = setTimeout(() => {
      state.lightTimer = null;
      state.ctx = SG.analyze(state.candles, { interval: settings.interval });
      renderChart();
      renderQuote();
    }, 1000);
  }

  /* ---------- Cálculo ---------- */
  function recompute(o) {
    o = o || {};
    const C = state.candles;
    if (C.length < SG.MIN_BARS + 5) {
      chart.set({ message: 'Hay muy pocas velas para analizar este par.' });
      return;
    }
    state.ctx = SG.analyze(C, { interval: settings.interval });
    const li = U.lastClosed(C);
    const from = Math.max(SG.MIN_BARS, li - 600);
    state.evalFrom = from;
    state.evals = SG.evaluateRange(state.ctx, sigOpts(), from, li);
    state.cur = state.evals[state.evals.length - 1] || null;
    state.markers = state.evals.filter((e, k) => SG.isFresh(state.evals, k)).map((e) => ({ i: e.i, dir: e.dir }));
    state.proj = projection();
    if (o.alert && state.cur && SG.isFresh(state.evals, state.evals.length - 1)) alertSignal(settings.symbol, settings.interval, state.cur, state.dec, 'gráfico');
    if (!state.demo) recordSignals(settings.symbol, settings.interval, C, state.evals.slice(-12), 'gráfico', state.dec, 3);
    renderAll();
  }

  function projection() {
    const cur = state.cur;
    if (!cur) return null;
    const bias = new Array(state.ctx.n).fill(NaN);
    for (const e of state.evals) bias[e.i] = e.bias;
    const sign = cur.dir || (Math.abs(cur.bias) >= 1 ? Math.sign(cur.bias) : 0);
    try {
      return ST.project(state.ctx, cur.i, { horizon: settings.horizon, signal: cur.dir ? cur : null, bias, from: state.evalFrom, biasSign: sign, paths: 2000, seed: 2024 });
    } catch (e) {
      return null;
    }
  }

  async function refreshTicker(token) {
    if (state.demo || !state.feed || !state.feed.ticker) return;
    try {
      const t = await state.feed.ticker(settings.symbol);
      if (token === state.token && t) {
        state.ticker = t;
        renderQuote();
      }
    } catch (e) {
      /* el precio sigue llegando por el flujo */
    }
  }

  async function refreshSentiment(token) {
    if (state.demo || !state.feed || state.feed.id !== 'binance') return;
    const s = await API.sentiment(settings.symbol);
    if (token !== state.token) return;
    state.sentiment = s;
    if (state.tab === 'projection') renderProjection();
  }

  /* ---------- Render ---------- */
  function renderAll() {
    renderQuote();
    renderChart();
    renderSignal();
    renderTab();
  }

  function renderQuote() {
    const C = state.candles;
    if (!C.length) return;
    const last = C[C.length - 1];
    const info = state.info;
    $('#q-sym').textContent = info ? info.base + '/' + info.quote : settings.symbol;
    $('#q-price').textContent = fp(last.c);
    const t = state.ticker;
    let chg = t ? (last.c / t.open - 1) * 100 : null;
    if (chg == null) {
      const step = U.INTERVALS[settings.interval];
      const back = Math.min(C.length - 1, Math.max(1, Math.round(86400e3 / step)));
      chg = (last.c / C[C.length - 1 - back].c - 1) * 100;
    }
    const el = $('#q-chg');
    el.textContent = pct(chg) + ' 24 h';
    el.className = 'chip num ' + (chg >= 0 ? 'up' : 'down');
    $('#q-price').className = 'num big ' + (last.c >= last.o ? 'up' : 'down');
    const meta = [];
    if (t) meta.push('Máx ' + fp(t.high), 'Mín ' + fp(t.low));
    if (t && ok(t.quoteVolume)) meta.push('Vol ' + compact(t.quoteVolume) + (info ? ' ' + info.quote : ''));
    const feed = state.feed;
    if (feed && feed.id === 'ecb') meta.push('Fijación diaria del BCE (14:15 CET) · sin mechas ni volumen');
    else meta.push(IV[settings.interval] + ' · cierre en <span class="countdown">' + countdown() + '</span>');
    if (feed && feed.id !== 'binance' && !state.demo) meta.push('Fuente: ' + feed.label + (F.marketOpen(new Date()) ? '' : ' · mercado cerrado'));
    $('#q-meta').innerHTML = meta.join(' · ');
    document.title = fp(last.c) + ' ' + settings.symbol + ' · Radar de Divisas';
  }

  function compact(x) {
    if (!ok(x)) return '—';
    const a = Math.abs(x);
    return a >= 1e9 ? (x / 1e9).toFixed(2) + ' mil M' : a >= 1e6 ? (x / 1e6).toFixed(2) + ' M' : a >= 1e3 ? (x / 1e3).toFixed(1) + ' k' : x.toFixed(0);
  }

  function countdown() {
    const C = state.candles;
    if (!C.length) return '—';
    const last = C[C.length - 1];
    const end = last.closed === false ? last.T + 1 : last.T + 1 + U.INTERVALS[settings.interval];
    const s = Math.max(0, Math.round((end - Date.now()) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0');
  }

  function renderChart() {
    if (!state.ctx) return;
    const cur = state.cur;
    const lines = cur && cur.dir ? [
      { price: cur.entry, kind: 'entry', label: 'Entrada' },
      { price: cur.stop, kind: 'stop', label: 'Stop' },
      { price: cur.target, kind: 'target', label: 'Objetivo' },
    ] : [];
    chart.set({
      S: state.ctx.S, ctx: state.ctx, markers: state.markers, levels: cur ? cur.levels : null, fib: cur ? cur.fib : null,
      figure: cur ? cur.figure : null, lines, cone: state.proj ? state.proj.cone : null, coneFrom: cur ? cur.i : null,
      decimals: state.dec, stepMs: state.ctx.stepMs,
    });
  }

  // Tamaño en lotes para divisas (con la divisa de la cuenta y los tipos del BCE).
  function fxSizing(entry, stop) {
    if (!isFx()) return null;
    return F.lotSize({ symbol: settings.symbol, capital: settings.capital, riskPct: settings.riskPct, entry, stop, account: settings.account, rates: state.rates });
  }

  function sizing(entry, stop, target) {
    return RK.positionSize({
      capital: settings.capital, riskPct: settings.riskPct, entry, stop, target, feePct: feeFor(),
      maxLeverage: futures() ? 3 : 1, stepSize: state.info ? state.info.stepSize : 0, minNotional: state.info ? state.info.minNotional : 0,
    });
  }

  function feeWarning(riskPct) {
    const rt = 2 * feeFor();
    if (!(riskPct > 0) || rt / riskPct < 0.2) return '';
    return `<div class="callout">Las comisiones (${nf(rt)} % ida y vuelta) equivalen al ${ppc(rt / riskPct)} de lo que arriesgas por operación: con tan poca volatilidad es muy difícil ganar. Prueba una temporalidad mayor o un par más volátil.</div>`;
  }

  function reasonList(sd, limit) {
    const items = sd.reasons.slice().sort((a, b) => b.w - a.w).slice(0, limit || 12);
    return '<ul class="reasons">' + items.map((r) => `<li class="${r.trigger ? 'trig' : ''}${r.w < 0 ? ' neg' : ''}"><span>${r.w < 0 ? '−' : r.trigger ? '▲' : '·'}</span><span class="t">${esc(r.text)}</span><span class="w">${r.w > 0 ? '+' : ''}${nf(r.w)}</span></li>`).join('') + '</ul>';
  }

  function renderSignal() {
    const el = $('#signal');
    const cur = state.cur;
    if (!cur) {
      el.innerHTML = '<p class="muted">Cargando análisis…</p>';
      return;
    }
    const thr = cur.threshold;
    const maxS = Math.max(thr + 3, cur.long.score, cur.short.score, 1);
    const bar = (v, col) => `<div class="track"><b style="width:${Math.max(0, Math.min(100, (v / maxS) * 100))}%;background:${col}"></b><i class="thr" style="left:${(thr / maxS) * 100}%"></i></div>`;
    const cls = cur.dir > 0 ? 'buy' : cur.dir < 0 ? 'sell' : '';
    let word = dirWord(cur.dir);
    if (cur.dir < 0 && !futures() && !isFx()) word = 'VENDER / CERRAR';
    let html = `<div class="verdict ${cls}"><div class="k">Señal · vela de ${IV[settings.interval]} cerrada ${when(cur.t)}</div><div class="v">${word}</div>`;
    html += cur.dir ? `<div class="small">Confluencia ${cur.strength} · ${nf(cur.score)} puntos (umbral ${nf(thr, 1)})</div>` : `<div class="small">${biasText(cur.bias)}</div>`;
    html += '</div>';
    html += `<div class="meter"><span>Compra</span>${bar(cur.long.score, 'var(--up)')}<span class="num">${nf(cur.long.score)}</span><span>Venta</span>${bar(cur.short.score, 'var(--down)')}<span class="num">${nf(cur.short.score)}</span></div>`;
    if (state.demo) html += '<div class="callout info">Modo demostración: precios simulados, no reales. No operes con estas señales.</div>';
    html += eventWarning(settings.symbol);
    if (cur.dir) {
      const fx = isFx() ? fxSizing(cur.entry, cur.stop) : null;
      const ps = fx ? null : sizing(cur.entry, cur.stop, cur.target);
      const hit = state.proj && state.proj.hit;
      const base = state.info ? state.info.base : '';
      const quote = state.info ? state.info.quote : '';
      html += '<dl class="kv">';
      html += `<dt>Entrada</dt><dd>${fp(cur.entry)}</dd>`;
      html += `<dt>Stop <span class="small">(${esc(cur.stopKind)})</span></dt><dd class="down">${fp(cur.stop)} <span class="small">${pct(((cur.stop / cur.entry) - 1) * 100)}</span></dd>`;
      html += `<dt>Objetivo (R:R ${nf(cur.rr, 1)})</dt><dd class="up">${fp(cur.target)} <span class="small">${pct(((cur.target / cur.entry) - 1) * 100)}</span></dd>`;
      if (hit) html += `<dt>Prob. objetivo antes que stop</dt><dd>${ppc(hit.target)} <span class="small">(mín. rentable ${ppc(hit.breakeven)})</span></dd>`;
      if (fx && !fx.error) {
        html += `<dt>Tamaño (${nf(settings.riskPct, 1)} % de ${nf(settings.capital, 0)} ${esc(fx.account)})</dt><dd>${nf(fx.lots, 2)} lotes</dd>`;
        html += `<dt>Unidades</dt><dd>${Math.round(fx.units).toLocaleString('es-ES')} ${esc(base)}</dd>`;
        html += `<dt>Stop</dt><dd>${nf(fx.pips, 1)} pips</dd>`;
        html += `<dt>Valor del pip</dt><dd>${nf(fx.pipValue)} ${esc(fx.account)}</dd>`;
        html += `<dt>Pérdida si salta el stop</dt><dd class="down">−${nf(fx.riskAcc)} ${esc(fx.account)}</dd>`;
      }
      if (ps) {
        html += `<dt>Tamaño (${nf(settings.riskPct, 1)} % de ${nf(settings.capital, 0)})</dt><dd>${nf(ps.qty, state.info && state.info.qtyDecimals != null ? state.info.qtyDecimals : 6)} ${esc(base)}</dd>`;
        html += `<dt>Valor de la posición</dt><dd>${nf(ps.notional)} ${esc(quote)}${ps.leverage > 1.01 ? ' · ' + nf(ps.leverage, 1) + '×' : ''}</dd>`;
        html += `<dt>Pérdida si salta el stop</dt><dd class="down">−${nf(ps.lossAtStop)} ${esc(quote)}</dd>`;
      }
      html += '</dl>';
      if (ps && ps.capped) html += '<div class="callout">El stop está tan cerca que para arriesgar ese porcentaje harías falta más capital del que tienes: el tamaño se ha limitado' + (futures() ? ' a 3× de apalancamiento.' : ' a tu capital (spot).') + '</div>';
      if (ps && ps.belowMin) html += `<div class="callout">La posición es menor que el mínimo de Binance para este par (${nf(state.info.minNotional)} ${esc(quote)}).</div>`;
      if (fx && fx.error) html += `<div class="callout">${esc(fx.error)} Abre la pestaña «Divisas» para cargar los tipos del BCE.</div>`;
      if (!state.demo && state.feed) {
        const url = state.feed.tradeUrl(state.info, settings.symbol, futures());
        if (isFx()) html += `<a class="btn" href="${url}" target="_blank" rel="noopener">Ver el par en TradingView ↗</a><p class="small muted">Las divisas se operan con un bróker de forex regulado. En Binance, el equivalente más cercano es EURUSDT.</p>`;
        else html += `<a class="btn primary" href="${url}" target="_blank" rel="noopener">Abrir en Binance ↗</a>`;
      }
      if (cur.spotNote) html += `<div class="callout">${esc(cur.spotNote)}</div>`;
      html += feeWarning(cur.riskPct);
      html += '<h3>Por qué</h3>' + reasonList(cur.dir > 0 ? cur.long : cur.short);
    } else {
      if (cur.blocked) html += `<div class="callout">${esc(cur.blocked)}</div>`;
      html += feeWarning((settings.atrStop * cur.atr * 100) / cur.price);
      const lead = cur.long.score >= cur.short.score ? cur.long : cur.short;
      const trigNeed = cur.minTrigger;
      const hint = lead.triggerScore < trigNeed ? `Falta un disparador (algo que ocurra al cierre de una vela: un cruce, una ruptura, un patrón de velas…). Lleva ${nf(lead.triggerScore)} de ${nf(trigNeed)} puntos.` : lead.score < cur.threshold ? `Falta confluencia: ${nf(lead.score)} de ${nf(cur.threshold, 1)} puntos.` : 'Las evidencias de compra y venta están demasiado igualadas.';
      html += `<p class="small muted">${hint}</p>`;
      html += `<h3>Lo que pesa ahora (${cur.long.score >= cur.short.score ? 'compra' : 'venta'})</h3>` + reasonList(lead, 8);
    }
    const lastSig = [...state.evals].reverse().find((e, k, arr) => e.dir && SG.isFresh(state.evals, state.evals.length - 1 - k));
    if (lastSig && lastSig !== cur) {
      const ago = cur.i - lastSig.i;
      const move = ((cur.price / lastSig.entry) - 1) * 100 * lastSig.dir;
      html += `<p class="small muted">Última señal: <strong class="${lastSig.dir > 0 ? 'up' : 'down'}">${dirWord(lastSig.dir)}</strong> hace ${ago} velas a ${fp(lastSig.entry)} (${pct(move)} a su favor desde entonces).</p>`;
    }
    const next = state.feed && state.feed.id === 'ecb' ? 'Se actualiza con la fijación diaria del BCE (14:15 CET, días laborables)' : `Próximo cierre en <span class="countdown num">${countdown()}</span>`;
    html += `<p class="small muted">${next}. Señal probabilística, no asesoramiento financiero.</p>`;
    el.innerHTML = html;
  }

  // Aviso de noticias de alto impacto para las divisas del par en las próximas 24 h.
  function eventWarning(sym) {
    if (!state.calendar) return '';
    const ev = F.eventRisk(state.calendar, F.currenciesOf(sym), Date.now(), 24);
    if (!ev) return '';
    const list = ev.slice(0, 3).map((e) => `${esc(e.country)} · ${esc(e.title)} (${when(e.t)})`).join('<br>');
    return `<div class="callout"><strong>Noticia de alto impacto en menos de 24 h:</strong><br>${list}<br>Los datos macro pueden mover el precio varias veces su rango normal en segundos y saltarse los stops. Considera esperar a que se publiquen.</div>`;
  }

  function biasText(b) {
    if (!ok(b) || Math.abs(b) < 1) return 'Sin ventaja clara para ningún lado';
    const s = Math.abs(b) >= 3 ? 'claro' : Math.abs(b) >= 2 ? 'moderado' : 'leve';
    return `Sesgo ${b > 0 ? 'alcista' : 'bajista'} ${s} (${b > 0 ? '+' : ''}${nf(b)}), sin señal todavía`;
  }

  /* ---------- Pestañas ---------- */
  function showTab(name) {
    state.tab = name;
    settings.tab = name;
    save();
    $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
    $$('.tab').forEach((s) => (s.hidden = s.id !== 'tab-' + name));
    if (name === 'alerts') {
      state.unseen = 0;
      renderBadge();
    }
    renderTab();
  }

  function renderTab() {
    const t = state.tab;
    if (t === 'projection') renderProjection();
    else if (t === 'analysis') renderAnalysis();
    else if (t === 'patterns') renderPatterns();
    else if (t === 'scanner') {
      renderScanner();
      if (!Object.keys(state.scan).length && !state.scanning) scanAll();
    }
    else if (t === 'alerts') renderAlerts();
    else if (t === 'risk') renderRisk();
    else if (t === 'forex') renderForex();
    else if (t === 'signals') renderSignals();
    else if (t === 'markets') renderMarkets();
    else if (t === 'prospect') renderProspect();
    else if (t === 'guide' && !$('#tab-guide').innerHTML) $('#tab-guide').innerHTML = FX.guide;
  }

  function card(k, v, p, cls) {
    return `<div class="card"><div class="k">${k}</div><div class="v ${cls || ''}">${v}</div>${p ? '<p>' + p + '</p>' : ''}</div>`;
  }

  function horizonText(H) {
    const ms = H * U.INTERVALS[settings.interval];
    const h = ms / 3600e3;
    return h < 1 ? Math.round(ms / 60e3) + ' min' : h < 48 ? (h % 1 ? h.toFixed(1) : h) + ' h' : (h / 24).toFixed(h % 24 ? 1 : 0) + ' días';
  }

  function renderProjection() {
    const el = $('#tab-projection');
    const P = state.proj;
    const cur = state.cur;
    if (!P || !cur) {
      el.innerHTML = '<p class="muted">Se necesitan al menos 120 velas para proyectar.</p>';
      return;
    }
    const H = P.horizon;
    const end = P.cone[P.cone.length - 1];
    const rel = (x) => pct((x / P.price - 1) * 100);
    let html = `<h2>Proyección a ${H} velas (≈ ${horizonText(H)})</h2>`;
    html += '<p class="small muted">Abanico de precios plausibles según la volatilidad actual (GARCH) y los movimientos reales del par (2 000 simulaciones). No es una predicción: el precio saldrá de la banda del 90 % aproximadamente 1 de cada 10 veces.</p>';
    html += '<div class="cards">';
    html += card('Rango probable (50 %)', `${fp(end.q25)} – ${fp(end.q75)}`, `${rel(end.q25)} / ${rel(end.q75)} · mediana ${fp(end.q50)}`);
    html += card('Rango amplio (90 %)', `${fp(end.q5)} – ${fp(end.q95)}`, `${rel(end.q5)} / ${rel(end.q95)}`);
    const vp = P.volPercentile;
    html += card('Volatilidad', `${nf(P.volAnnual * 100, 1)} % anual`, `${nf(P.volBar * 100, 3)} % por vela · percentil ${nf(vp * 100, 0)} de su historia (${vp > 0.8 ? 'alta' : vp < 0.2 ? 'baja: suele preceder a movimientos amplios' : 'normal'}). Persistencia GARCH ${nf(P.garch.persistence, 2)}.`);
    const regimeTxt = {
      persistente: 'Los movimientos tienden a continuar: funcionan mejor las rupturas y el seguimiento de tendencia.',
      antipersistente: 'Los movimientos tienden a revertirse: funcionan mejor los rebotes en soportes y resistencias.',
      aleatorio: 'Sin memoria apreciable: el precio se comporta casi como un paseo aleatorio.',
      indeterminado: 'Datos insuficientes.',
    }[P.regime];
    const vr = P.varianceRatio;
    html += card('Régimen (Hurst)', `H = ${nf(P.hurst, 2)} · ${P.regime}`, `${regimeTxt} Ratio de varianzas VR(4) = ${nf(vr.vr, 2)} (z = ${nf(vr.z, 1)}${Math.abs(vr.z) > 1.96 ? ', significativo' : ', no significativo'}).`);
    if (P.base && P.base.cond && P.base.cond.n) {
      const c = P.base.cond;
      const a = P.base.all;
      const word = P.base.sign > 0 ? 'alcista' : 'bajista';
      const overlap = c.ci[0] <= a.ci[1] && c.ci[1] >= a.ci[0];
      html += card(`Tasa base (sesgo ${word})`, `${ppc(c.pUp)} subió`, `En este par, tras situaciones con sesgo ${word} como la actual, el precio estaba más alto ${H} velas después el ${ppc(c.pUp)} de las veces (IC 95 %: ${ppc(c.ci[0])}–${ppc(c.ci[1])}, n = ${c.n}). En cualquier momento: ${ppc(a.pUp)} (n = ${a.n}). ${overlap ? 'Los intervalos se solapan: sin evidencia de ventaja en esta muestra.' : 'Diferencia apreciable frente a la tasa general.'}`);
    } else if (P.base) {
      html += card('Tasa base', `${ppc(P.base.all.pUp)} subió`, `Sin sesgo claro ahora. En este par el precio estaba más alto ${H} velas después el ${ppc(P.base.all.pUp)} de las veces (n = ${P.base.all.n}).`);
    }
    if (P.hit && cur.dir) {
      html += card('Probabilidad de la señal', ppc(P.hit.target), `de tocar el objetivo antes que el stop en ${H} velas (stop primero: ${ppc(P.hit.stop)}; ninguno: ${ppc(P.hit.none)}). Para ganar con R:R ${nf(cur.rr, 1)} basta superar el ${ppc(P.hit.breakeven)} sin contar comisiones. Supone deriva nula: es la referencia «sin ventaja».`);
    }
    const m = P.moments;
    html += card('Colas de la distribución', `curtosis ${nf(m.kurt, 1)}`, `Asimetría ${nf(m.skew, 2)}. ${m.kurt > 3 ? 'Colas muy gruesas: los movimientos extremos son mucho más frecuentes de lo que diría una campana normal.' : m.kurt > 1 ? 'Colas gruesas: más sustos de lo normal.' : 'Colas cercanas a la normal.'}`);
    html += '</div>';

    // Escenarios
    html += '<h3>Escenarios</h3>' + scenarios(cur, P);

    // Niveles clave
    html += '<h3>Niveles clave</h3>' + keyLevels(cur);

    // Sentimiento de derivados
    html += '<h3>Sentimiento en futuros</h3>';
    const s = state.sentiment;
    if (state.demo) html += '<p class="small muted">No disponible en modo demostración.</p>';
    else if (state.feed && state.feed.id !== 'binance') html += '<p class="small muted">Solo para pares de Binance con futuros perpetuos. En divisas, consulta el informe COT de la CFTC (posicionamiento semanal de los grandes especuladores).</p>';
    else if (!s) html += '<p class="small muted">Este par no tiene futuros perpetuos en Binance (o no se pudieron consultar).</p>';
    else {
      html += '<div class="cards">';
      const f = s.funding * 100;
      html += card('Financiación', pct(f, 4), f > 0.03 ? 'Alta: muchos largos apalancados pagan por mantenerse; riesgo de barridas a la baja.' : f < -0.01 ? 'Negativa: dominan los cortos; riesgo de subidas bruscas por cierres de cortos.' : 'Neutral.');
      if (s.longShort != null) html += card('Cuentas largas / cortas', nf(s.longShort, 2), `${nf(s.longPct, 0)} % de las cuentas en largo. La mayoría suele equivocarse en los extremos (lectura contraria).`);
      if (s.oiChangePct != null) html += card('Interés abierto 24 h', pct(s.oiChangePct, 1), s.oiChangePct > 5 ? 'Entra dinero nuevo: el movimiento tiene combustible.' : s.oiChangePct < -5 ? 'Salen posiciones: movimiento por cierres, suele agotarse.' : 'Estable.');
      html += '</div>';
    }
    el.innerHTML = html;
  }

  function scenarios(cur, P) {
    const st = cur.structure || {};
    const up = (cur.levels.resistances[0] || {}).price || (st.lastHigh || {}).price;
    const dn = (cur.levels.supports[0] || {}).price || (st.lastLow || {}).price;
    const end = P.cone[P.cone.length - 1];
    const fib = cur.fib;
    const upT = [];
    const dnT = [];
    if (cur.levels.resistances[1]) upT.push(fp(cur.levels.resistances[1].price) + ' (siguiente resistencia)');
    if (cur.levels.supports[1]) dnT.push(fp(cur.levels.supports[1].price) + ' (siguiente soporte)');
    if (fib && fib.upSwing) upT.push(fp(fib.ext[1].price) + ' (Fibonacci 161.8 %)');
    if (fib && !fib.upSwing) dnT.push(fp(fib.ext[1].price) + ' (Fibonacci 161.8 %)');
    upT.push(fp(end.q95) + ' (techo del 90 %)');
    dnT.push(fp(end.q5) + ' (suelo del 90 %)');
    const lean = cur.bias >= 1 ? 'alcista' : cur.bias <= -1 ? 'bajista' : null;
    let html = '<div class="cards">';
    html += card('Escenario alcista', up ? 'cierre > ' + fp(up) : '—', up ? 'Si una vela cierra por encima, objetivos: ' + upT.join(' · ') : '');
    html += card('Escenario bajista', dn ? 'cierre < ' + fp(dn) : '—', dn ? 'Si una vela cierra por debajo, objetivos: ' + dnT.join(' · ') : '');
    html += card('Escenario central', `${fp(end.q25)} – ${fp(end.q75)}`, lean ? `El análisis se inclina ${lean}, pero entre ambos niveles lo más probable es oscilación.` : 'Sin sesgo claro: entre ambos niveles lo más probable es oscilación lateral.');
    return html + '</div>';
  }

  function keyLevels(cur) {
    const ctx = state.ctx;
    const i = cur.i;
    const rows = [];
    cur.levels.supports.slice(0, 4).forEach((z) => rows.push({ p: z.price, n: `Soporte (${z.touches} toques)`, c: 'up' }));
    cur.levels.resistances.slice(0, 4).forEach((z) => rows.push({ p: z.price, n: `Resistencia (${z.touches} toques)`, c: 'down' }));
    const pp = FX.patterns.pivotPoints(ctx.S, i, ctx.stepMs);
    if (pp) ['R3', 'R2', 'R1', 'P', 'S1', 'S2', 'S3'].forEach((k) => rows.push({ p: pp[k], n: `Pivote ${k === 'P' ? 'central' : k} (${pp.period})` }));
    if (cur.fib) cur.fib.retr.forEach((r) => rows.push({ p: r.price, n: `Fibonacci ${(r.r * 100).toFixed(1)} %` }));
    const add = (p, n) => ok(p) && rows.push({ p, n });
    add(ctx.ema200[i], 'EMA 200');
    add(ctx.ema50[i], 'EMA 50');
    add(ctx.vwap[i], 'VWAP');
    add(ctx.ich.kijun[i], 'Kijun-sen (Ichimoku)');
    add(Math.max(ctx.ich.senkouA[i], ctx.ich.senkouB[i]), 'Techo de la nube');
    add(Math.min(ctx.ich.senkouA[i], ctx.ich.senkouB[i]), 'Suelo de la nube');
    rows.sort((a, b) => b.p - a.p);
    const price = cur.price;
    let html = '<div class="table-wrap"><table class="table"><thead><tr><th>Nivel</th><th class="num">Precio</th><th class="num">Distancia</th></tr></thead><tbody>';
    let marked = false;
    for (const r of rows) {
      if (!marked && r.p < price) {
        html += `<tr class="group-row"><td>Precio actual</td><td class="num">${fp(price)}</td><td class="num">—</td></tr>`;
        marked = true;
      }
      html += `<tr><td class="${r.c || ''}">${esc(r.n)}</td><td class="num">${fp(r.p)}</td><td class="num">${pct((r.p / price - 1) * 100)}</td></tr>`;
    }
    if (!marked) html += `<tr class="group-row"><td>Precio actual</td><td class="num">${fp(price)}</td><td class="num">—</td></tr>`;
    return html + '</tbody></table></div>';
  }

  function renderAnalysis() {
    const el = $('#tab-analysis');
    const cur = state.cur;
    if (!cur || !cur.snap) {
      el.innerHTML = '<p class="muted">Sin análisis.</p>';
      return;
    }
    const G = SG.GROUPS;
    const sum = (sd, g) => sd.reasons.filter((r) => r.group === g && r.w > 0).reduce((s, r) => s + r.w, 0);
    let html = '<h2>Desglose por escuela</h2><p class="small muted">Cada escuela aporta como máximo su tope; los factores en contra restan. ▲ = disparador (algo que acaba de ocurrir en esta vela).</p>';
    html += '<div class="table-wrap"><table class="table"><thead><tr><th>Escuela</th><th class="num">Compra</th><th class="num">Venta</th><th class="num">Tope</th></tr></thead><tbody>';
    for (const g in G) {
      const L = Math.min(G[g].cap, sum(cur.long, g));
      const S = Math.min(G[g].cap, sum(cur.short, g));
      html += `<tr class="group-row"><td>${G[g].label} <span class="small muted">· ${G[g].desc}</span></td><td class="num up">${L ? '+' + nf(L) : '—'}</td><td class="num down">${S ? '+' + nf(S) : '—'}</td><td class="num">${nf(G[g].cap)}</td></tr>`;
      const items = [...cur.long.reasons.map((r) => ({ ...r, side: 1 })), ...cur.short.reasons.map((r) => ({ ...r, side: -1 }))].filter((r) => r.group === g);
      for (const r of items) html += `<tr><td>${r.trigger ? '▲ ' : ''}${esc(r.text)}</td><td class="num">${r.side > 0 ? (r.w > 0 ? '+' : '') + nf(r.w) : ''}</td><td class="num">${r.side < 0 ? (r.w > 0 ? '+' : '') + nf(r.w) : ''}</td><td></td></tr>`;
    }
    html += `<tr class="group-row"><td>Total</td><td class="num up">${nf(cur.long.score)}</td><td class="num down">${nf(cur.short.score)}</td><td class="num">umbral ${nf(cur.threshold, 1)}</td></tr>`;
    html += '</tbody></table></div>';

    const s = cur.snap;
    const zone = (v, lo, hi) => (v >= hi ? 'sobrecompra' : v <= lo ? 'sobreventa' : 'neutral');
    const ctx = state.ctx;
    html += '<h2>Indicadores</h2><div class="cards">';
    html += card('RSI 14', nf(s.rsi, 1), zone(s.rsi, 30, 70));
    html += card('MACD (histograma)', nf(s.macdHist, state.dec + 1), s.macdHist > 0 ? 'Momento alcista' : 'Momento bajista');
    html += card('ADX 14', nf(s.adx, 1), s.adx > 25 ? 'Tendencia con fuerza' : s.adx < 20 ? 'Sin tendencia (rango)' : 'Tendencia débil');
    html += card('Estocástico %K', nf(s.stochK, 1), zone(s.stochK, 20, 80));
    html += card('CCI 20', nf(s.cci, 0), s.cci > 100 ? 'Fuerte al alza' : s.cci < -100 ? 'Fuerte a la baja' : 'Neutral');
    html += card('MFI 14', nf(s.mfi, 1), zone(s.mfi, 20, 80) + ' (ponderado por volumen)');
    html += card('Chaikin (CMF 20)', nf(s.cmf, 3), s.cmf > 0.05 ? 'Presión compradora' : s.cmf < -0.05 ? 'Presión vendedora' : 'Equilibrio');
    html += card('Bollinger %B', nf(s.pctB, 2), s.pctB > 1 ? 'Fuera por arriba' : s.pctB < 0 ? 'Fuera por abajo' : 'Dentro de las bandas');
    html += card('ATR 14', nf(s.atrPct, 3) + ' %', 'Movimiento típico por vela');
    html += card('Supertrend 10/3', s.supertrend > 0 ? 'Alcista' : 'Bajista', '', s.supertrend > 0 ? 'up' : 'down');
    html += card('Ichimoku', s.ichimoku > 0 ? 'Sobre la nube' : s.ichimoku < 0 ? 'Bajo la nube' : 'Dentro de la nube', s.ichimoku === 0 ? 'Zona de indecisión' : '', s.ichimoku > 0 ? 'up' : s.ichimoku < 0 ? 'down' : '');
    html += card('Medias', ['EMA 20', 'EMA 50', 'EMA 200'].map((n, k) => `${n}: ${pct(((cur.price / [s.ema20, s.ema50, s.ema200][k]) - 1) * 100)}`).join('<br>'), 'Distancia del precio a cada media');
    html += card('Teoría de Dow', cur.structure ? esc(cur.structure.label) : '—', '');
    html += card(`Temporalidad superior (${ctx.htf || '—'})`, cur.htf > 0 ? 'Alcista' : cur.htf < 0 ? 'Bajista' : 'Neutral', '', cur.htf > 0 ? 'up' : cur.htf < 0 ? 'down' : '');
    html += card('Regresión 50 velas', 't = ' + nf(s.tstat, 2), Math.abs(s.tstat) > 2 ? 'Pendiente estadísticamente significativa' : 'Pendiente no significativa');
    html += card('Hurst (256 velas)', nf(s.hurst, 2), cur.regime ? 'Régimen ' + cur.regime : 'Insuficientes datos');
    html += card('Figura en curso', cur.figure ? esc(cur.figure.name) : 'Ninguna', cur.figure ? 'Directrices dibujadas en el gráfico (capa «Niveles y figuras»)' : '');
    html += '</div>';
    if (cur.info.length) html += cur.info.map((t) => `<div class="callout info">${esc(t)}</div>`).join('');
    el.innerHTML = html;
  }

  const CAT = (k) => (/Div$/i.test(k) ? 'Divergencia' : /^(hs|ihs|double|fig|bullFlag|bearFlag)/.test(k) ? 'Figura' : /^(bos|choch)$/.test(k) ? 'Estructura' : /^fib/.test(k) ? 'Fibonacci' : /^fvg/.test(k) ? 'Hueco de valor' : /^chan/.test(k) ? 'Canal' : 'Vela');

  function renderPatterns() {
    const el = $('#tab-patterns');
    const evs = state.evals.slice(-150).reverse();
    const rows = [];
    for (const e of evs) {
      for (const p of e.patterns) if (p.dir) rows.push({ t: e.t, cat: 'Vela', name: p.name, dir: p.dir, price: e.price });
      for (const p of e.events) rows.push({ t: e.t, cat: CAT(p.key), name: p.name, dir: p.dir, price: e.price });
    }
    let html = '<h2>Patrones detectados recientemente</h2><p class="small muted">Últimas 150 velas cerradas, de la más reciente a la más antigua. Un patrón aislado no es una señal: la señal aparece cuando varios coinciden.</p>';
    if (!rows.length) html += '<p class="muted">No se han detectado patrones relevantes.</p>';
    else {
      html += '<div class="table-wrap"><table class="table"><thead><tr><th>Vela</th><th>Tipo</th><th>Patrón</th><th>Sentido</th><th class="num">Precio</th></tr></thead><tbody>';
      for (const r of rows.slice(0, 80)) html += `<tr><td>${when(r.t)}</td><td>${r.cat}</td><td>${esc(r.name)}</td><td><span class="chip ${r.dir > 0 ? 'up' : 'down'}">${r.dir > 0 ? 'alcista' : 'bajista'}</span></td><td class="num">${fp(r.price)}</td></tr>`;
      html += '</tbody></table></div>';
    }
    el.innerHTML = html;
  }

  /* ---------- Avisos ---------- */
  let audio = null;
  function beep(dir) {
    if (!settings.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const notes = dir > 0 ? [660, 880] : [660, 440];
      notes.forEach((f, k) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, audio.currentTime + k * 0.18);
        g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + k * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + k * 0.18 + 0.16);
        o.connect(g).connect(audio.destination);
        o.start(audio.currentTime + k * 0.18);
        o.stop(audio.currentTime + k * 0.18 + 0.17);
      });
    } catch (e) {
      /* sin audio */
    }
  }

  function toast(title, body, dir) {
    const t = document.createElement('div');
    t.className = 'toast ' + (dir > 0 ? 'buy' : dir < 0 ? 'sell' : '');
    t.innerHTML = `<strong>${esc(title)}</strong>${esc(body)}`;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 9000);
  }

  async function notify(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', renotify: true, data: { url: location.href } };
    try {
      const reg = !window.radarDesktop && navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) return reg.showNotification(title, opts);
    } catch (e) {
      /* sin service worker */
    }
    try {
      const n = new Notification(title, opts);
      // En la app de escritorio, pulsar el aviso trae la ventana al frente (aunque esté en la bandeja).
      n.onclick = () => (window.radarDesktop ? window.radarDesktop.show() : window.focus());
    } catch (e) {
      /* el navegador no permite notificaciones aquí */
    }
  }

  // quiet: solo se anota en el historial (el análisis de mercados agrupa sus avisos en uno).
  function alertSignal(sym, iv, r, dec, src, quiet) {
    const key = [sym, iv, r.t, r.dir].join('|');
    if (state.alertKeys.has(key)) return false;
    state.alertKeys.add(key);
    store.set('fx.alertKeys', Array.from(state.alertKeys).slice(-300));
    const side = r.dir > 0 ? r.long : r.short;
    const a = {
      id: key, at: Date.now(), sym, iv, dir: r.dir, t: r.t, price: r.entry, stop: r.stop, target: r.target, score: r.score,
      strength: r.strength, dec, src, spot: !futures() && !F.isForex(sym), demo: state.demo,
      reasons: side.reasons.filter((x) => x.trigger).sort((x, y) => y.w - x.w).slice(0, 4).map((x) => x.text),
    };
    state.alerts.unshift(a);
    state.alerts = state.alerts.slice(0, 200);
    store.set('fx.alerts', state.alerts);
    if (state.tab !== 'alerts') state.unseen++;
    if (quiet) {
      renderBadge();
      return true;
    }
    const word = r.dir > 0 ? 'COMPRA' : a.spot ? 'VENTA (cerrar compras)' : 'VENTA';
    const title = `${word} · ${sym} · ${IV[iv] || iv}${state.demo ? ' (demo)' : ''}`;
    const body = `Entrada ${U.fmtPrice(r.entry, dec)} · Stop ${U.fmtPrice(r.stop, dec)} · Objetivo ${U.fmtPrice(r.target, dec)}. ${a.reasons[0] || ''}`;
    toast(title, ' ' + body, r.dir);
    if (window.radarDesktop) window.radarDesktop.alert(title);
    beep(r.dir);
    if (navigator.vibrate) navigator.vibrate(r.dir > 0 ? [80, 60, 80] : [200]);
    notify(title, body, key);
    renderBadge();
    if (state.tab === 'alerts') renderAlerts();
    return true;
  }

  function renderBadge() {
    const b = $('#alert-badge');
    b.hidden = !state.unseen;
    b.textContent = state.unseen;
  }

  function renderAlerts() {
    const perm = !('Notification' in window) ? 'Este navegador no admite notificaciones: los avisos se mostrarán dentro de la app.' : Notification.permission === 'granted' ? 'Notificaciones activadas.' : Notification.permission === 'denied' ? 'Has bloqueado las notificaciones para esta web: actívalas en los ajustes del navegador.' : 'Pulsa «Activar avisos» para recibir notificaciones del sistema.';
    $('#notif-state').textContent = perm + (window.radarDesktop ? ' Si cierras la ventana, la app sigue en la bandeja del sistema y te sigue avisando.' : ' Los avisos solo llegan mientras la app esté abierta (aunque esté en segundo plano).');
    const L = state.alerts;
    $('#alerts-list').innerHTML = !L.length ? '<p class="muted">Todavía no hay avisos. Aparecerán aquí cuando el análisis detecte una entrada en el par del gráfico o en tu lista del escáner.</p>' : L.map((a) => `
      <div class="alert-item">
        <span class="chip ${a.dir > 0 ? 'up' : 'down'}">${a.dir > 0 ? 'COMPRA' : 'VENTA'}</span>
        <strong class="num">${esc(a.sym)} · ${IV[a.iv] || esc(a.iv)}${a.demo ? ' · demo' : ''}</strong>
        <span class="small muted">${when(a.at)}</span>
        <p class="num">Entrada ${U.fmtPrice(a.price, a.dec)} · Stop ${U.fmtPrice(a.stop, a.dec)} · Objetivo ${U.fmtPrice(a.target, a.dec)} · ${nf(a.score)} puntos (${esc(a.strength)})</p>
        <p>${a.reasons.map(esc).join(' · ')}</p>
      </div>`).join('');
  }

  async function enableAlerts() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
    } catch (e) {
      /* sin audio */
    }
    if (!('Notification' in window)) {
      toast('Avisos dentro de la app', ' Este navegador no admite notificaciones del sistema.', 0);
      return;
    }
    if (Notification.permission === 'default') await Notification.requestPermission();
    renderBell();
    if (Notification.permission === 'granted') toast('Avisos activados', ' Te avisaremos de cada nueva entrada mientras la app esté abierta.', 0);
  }

  function renderBell() {
    const on = 'Notification' in window && Notification.permission === 'granted';
    const b = $('#bell');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    $('span', b).textContent = on ? 'Avisos activos' : 'Activar avisos';
  }

  /* ---------- Escáner ---------- */
  function renderScanner() {
    const rows = settings.watch.map((sym) => {
      const r = state.scan[sym];
      if (!r) return `<tr><td class="num"><strong>${esc(sym)}</strong></td><td colspan="6" class="muted">Pendiente</td><td><button class="btn icon" data-del="${esc(sym)}" aria-label="Quitar ${esc(sym)}">×</button></td></tr>`;
      if (r.err) return `<tr><td class="num"><strong>${esc(sym)}</strong></td><td colspan="6" class="down small">${esc(r.err)}</td><td><button class="btn icon" data-del="${esc(sym)}" aria-label="Quitar ${esc(sym)}">×</button></td></tr>`;
      const e = r.r;
      const sig = e.dir ? `<span class="chip ${e.dir > 0 ? 'up' : 'down'}">${dirWord(e.dir)}${r.fresh ? ' · nueva' : ''}</span>` : `<span class="small muted">${e.bias >= 1 ? 'sesgo alcista' : e.bias <= -1 ? 'sesgo bajista' : 'esperar'}</span>`;
      const src = r.iv !== settings.scanInterval || r.feedId !== 'binance' ? `<br><span class="small muted">${IV[r.iv]} · ${esc(r.source)}</span>` : '';
      return `<tr class="click" data-sym="${esc(sym)}">
        <td class="num"><strong>${esc(sym)}</strong>${src}</td>
        <td class="num">${U.fmtPrice(r.price, r.dec)}</td>
        <td class="num ${r.chg >= 0 ? 'up' : 'down'}">${pct(r.chg)}</td>
        <td>${e.trend > 0 ? '<span class="up">alcista</span>' : e.trend < 0 ? '<span class="down">bajista</span>' : 'lateral'}</td>
        <td class="num">${nf(e.snap.rsi, 0)}</td>
        <td class="num"><span class="up">${nf(e.long.score, 1)}</span> / <span class="down">${nf(e.short.score, 1)}</span></td>
        <td>${sig}</td>
        <td><button class="btn icon" data-del="${esc(sym)}" aria-label="Quitar ${esc(sym)}">×</button></td></tr>`;
    });
    $('#scan-table').innerHTML = '<thead><tr><th>Par</th><th class="num">Precio</th><th class="num">24 h</th><th>Tendencia</th><th class="num">RSI</th><th class="num">Compra / venta</th><th>Señal</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody>';
  }

  /* Binance se consulta en cada pasada; las fuentes de divisas solo cuando
   * cierra una vela nueva (el plan gratuito de Twelve Data tiene pocos créditos). */
  function scanDue(sym, feed, iv) {
    const prev = state.scan[sym];
    if (!feed || feed.live || !prev || prev.err || prev.iv !== iv || prev.feedId !== feed.id) return true;
    if (feed.id === 'ecb') return Date.now() - prev.at > 30 * 60e3;
    return Date.now() >= prev.nextClose + 8000;
  }

  async function scanAll() {
    if (state.scanning) return;
    state.scanning = true;
    $('#scan-status').textContent = 'Escaneando…';
    for (const sym of settings.watch.slice()) {
      const feed = state.demo ? null : feedFor(sym);
      let iv = settings.scanInterval;
      try {
        if (!state.demo && !feed) throw new Error('Para este par hace falta una clave de Twelve Data (no está entre los tipos del BCE).');
        if (feed && !feed.intervals.includes(iv)) iv = '1d';
        if (!scanDue(sym, feed, iv)) continue;
        const kl = state.demo ? demoCandles(sym, iv, 400) : await feed.klines(sym, iv, 400);
        if (kl.length < SG.MIN_BARS + 5) throw new Error('Pocas velas para analizar.');
        const ctx = SG.analyze(kl, { interval: iv });
        const li = U.lastClosed(kl);
        const dec = F.isForex(sym) ? F.decimals(sym) : U.autoDecimals(kl[li].c);
        const evs = SG.evaluateRange(ctx, sigOpts(dec, sym), li - SG.COOLDOWN, li);
        const r = evs[evs.length - 1];
        const fresh = SG.isFresh(evs, evs.length - 1);
        const lastK = kl[kl.length - 1];
        let k0 = kl.length - 1;
        while (k0 > 0 && kl[k0].t > lastK.t - 86400e3) k0--;
        const step = U.INTERVALS[iv];
        state.scan[sym] = {
          price: lastK.c, chg: (lastK.c / kl[k0].c - 1) * 100, r, fresh, dec, iv, feedId: feed ? feed.id : 'demo',
          source: feed ? feed.label : 'demo', at: Date.now(), nextClose: lastK.closed === false ? lastK.T + 1 : lastK.T + 1 + step,
        };
        if (fresh) alertSignal(sym, iv, r, dec, 'escáner');
        if (!state.demo) recordSignals(sym, iv, kl, evs, 'escáner', dec, 0);
      } catch (e) {
        state.scan[sym] = { err: e.message || String(e) };
      }
      if (state.tab === 'scanner') renderScanner();
    }
    state.scanning = false;
    scheduleScan();
  }

  function scheduleScan() {
    clearTimeout(state.scanTimer);
    if (!settings.scanOn) {
      $('#scan-status').textContent = 'Escaneo automático desactivado.';
      return;
    }
    const step = U.INTERVALS[settings.scanInterval];
    const untilClose = step - (Date.now() % step);
    const delay = Math.min(120000, untilClose + 4000);
    state.scanNext = Date.now() + delay;
    $('#scan-status').textContent = `Último escaneo: ${TM.format(new Date())}. Próximo: ${TM.format(new Date(state.scanNext))}.`;
    state.scanTimer = setTimeout(scanAll, delay);
  }

  /* ---------- Backtest ---------- */
  async function runBacktest() {
    const out = $('#bt-out');
    const btn = $('#bt-run');
    const bars = +$('#bt-bars').value;
    const maxBars = Math.max(2, +$('#bt-maxbars').value || 48);
    btn.disabled = true;
    try {
      let C;
      if (state.demo) C = demoCandles(settings.symbol, settings.interval, bars);
      else {
        out.innerHTML = '<p class="muted">Descargando histórico…</p>';
        if (!state.feed) throw new Error('No hay fuente de datos para este par.');
        C = await state.feed.history(settings.symbol, settings.interval, bars, (got, tot) => (out.innerHTML = `<p class="muted">Descargando histórico… ${got} / ${tot} velas</p>`));
      }
      C = C.filter((k) => k.closed !== false);
      if (C.length < 300) throw new Error('Hacen falta al menos 300 velas cerradas para un backtest.');
      out.innerHTML = `<p class="muted">Analizando ${C.length} velas…</p>`;
      await sleep(30);
      const ctx = SG.analyze(C, { interval: settings.interval });
      // Apalancamiento máximo: 1× en spot, 3× en futuros de Binance y 10× en divisas (bróker de forex).
      const lev = isFx() ? 10 : futures() ? 3 : 1;
      const res = BT.run(ctx, Object.assign(sigOpts(U.autoDecimals(C[C.length - 1].c)), { capital: settings.capital, riskPct: settings.riskPct, feePct: feeFor(), maxBars, maxLeverage: lev }));
      renderBacktest(res, C.length);
    } catch (e) {
      out.innerHTML = `<div class="error">${esc(e.message || e)}</div>`;
    } finally {
      btn.disabled = false;
    }
  }

  function renderBacktest(res, nBars) {
    const s = res.stats;
    const out = $('#bt-out');
    const verdict = [];
    if (s.trades < 30) verdict.push(`Muestra pequeña (${s.trades} operaciones): el resultado puede deberse al azar. Prueba con más histórico o con otra temporalidad.`);
    const [lo, hi] = s.expectancyCI;
    if (s.trades >= 2) {
      if (lo > 0) verdict.push('La esperanza por operación es positiva y su intervalo de confianza no incluye el cero en este periodo. Buena señal, pero no garantiza el futuro: los mercados cambian.');
      else if (hi < 0) verdict.push('La estrategia perdió dinero de forma consistente en este par y temporalidad: no la uses aquí tal como está.');
      else verdict.push('No se puede distinguir del azar: el intervalo de confianza de la esperanza incluye el cero.');
    }
    if (ok(s.buyHoldPct) && s.netPct < s.buyHoldPct) verdict.push(`Comprar y mantener habría rendido más (${pct(s.buyHoldPct, 1)} frente a ${pct(s.netPct, 1)}).`);
    const feePct = (s.feesPaid / settings.capital) * 100;
    if (feePct > 5) verdict.push(`Las comisiones se llevaron un ${nf(feePct, 1)} % del capital inicial: en este par y temporalidad pesan mucho.`);
    verdict.push('Si cambias los ajustes hasta que el backtest salga bien, estarás sobreajustando al pasado y el resultado real será peor.');
    const pf = s.profitFactor === Infinity ? '∞' : nf(s.profitFactor, 2);
    let html = `<p class="small muted">${nBars} velas · ${when(s.from)} – ${when(s.to)} · ${settings.symbol} ${IV[settings.interval]} · perfil ${SG.PROFILES[settings.profile].label.toLowerCase()} · ${isFx() ? 'largos y cortos (máx. 10×) · coste ' + nf(feeFor()) + ' % por lado · ' + (state.feed ? state.feed.label : '') : futures() ? 'largos y cortos (máx. 3×)' : 'solo largos (spot)'}${state.demo ? ' · datos simulados' : ''}</p>`;
    html += '<div class="cards">';
    html += card('Operaciones', s.trades, `${s.longs} compras · ${s.shorts} ventas · ${nf(s.avgBars, 1)} velas de media`);
    html += card('Acierto', ppc(s.winRate, 1), `necesario para no perder con R:R ${nf(settings.rr, 1)}: ${ppc(s.breakevenWinRate, 1)} + comisiones`, s.winRate > s.breakevenWinRate ? 'up' : 'down');
    html += card('Factor de beneficio', pf, 'ganancias / pérdidas brutas', s.profitFactor > 1 ? 'up' : 'down');
    html += card('Esperanza', (s.expectancyR > 0 ? '+' : '') + nf(s.expectancyR, 2) + ' R', `IC 95 %: ${nf(lo, 2)} a ${nf(hi, 2)} R por operación`, s.expectancyR > 0 ? 'up' : 'down');
    html += card('Rentabilidad neta', pct(s.netPct, 1), `${nf(settings.capital, 0)} → ${nf(s.finalEquity, 0)}`, s.netPct >= 0 ? 'up' : 'down');
    html += card('Máxima caída', '−' + nf(s.maxDDPct, 1) + ' %', `racha perdedora más larga: ${s.maxLosingStreak}`);
    html += card('Comprar y mantener', pct(s.buyHoldPct, 1), 'mismo periodo, sin operar');
    html += card('Comisiones pagadas', nf(s.feesPaid, 2), `${nf(feePct, 1)} % del capital · exposición ${ppc(s.exposure)}`);
    html += '</div>';
    html += verdict.map((v) => `<div class="callout">${esc(v)}</div>`).join('');
    html += '<h3>Curva de capital</h3><div><canvas id="bt-curve"></canvas></div>';
    const T = res.trades.slice(-100).reverse();
    if (T.length) {
      html += `<h3>Operaciones${res.trades.length > 100 ? ' (últimas 100)' : ''}</h3><div class="table-wrap"><table class="table"><thead><tr><th>Entrada</th><th>Sentido</th><th class="num">Precio</th><th class="num">Salida</th><th>Motivo</th><th class="num">Velas</th><th class="num">R</th><th class="num">Resultado</th></tr></thead><tbody>`;
      const d = state.demo ? U.autoDecimals(T[0].entry) : state.dec;
      for (const t of T) html += `<tr><td>${when(t.t0)}</td><td><span class="chip ${t.dir > 0 ? 'up' : 'down'}">${t.dir > 0 ? 'compra' : 'venta'}</span></td><td class="num">${U.fmtPrice(t.entry, d)}</td><td class="num">${U.fmtPrice(t.exit, d)}</td><td>${esc(t.reason)}</td><td class="num">${t.bars}</td><td class="num ${t.r >= 0 ? 'up' : 'down'}">${(t.r > 0 ? '+' : '') + nf(t.r, 2)}</td><td class="num ${t.pnl >= 0 ? 'up' : 'down'}">${pct(t.retPct)}</td></tr>`;
      html += '</tbody></table></div>';
    }
    out.innerHTML = html;
    FX.lineChart($('#bt-curve'), res.curve.map((p) => p.equity), { base: settings.capital, height: 200 });
  }

  /* ---------- Riesgo ---------- */
  function renderRisk() {
    const v = (id) => parseFloat($(id).value);
    const capital = v('#rk-capital');
    const riskPct = v('#rk-risk');
    const entry = v('#rk-entry');
    const stop = v('#rk-stop');
    const target = v('#rk-target');
    const lev = Math.max(1, v('#rk-lev') || 1);
    const out = $('#rk-out');
    if (!(entry > 0) || !(stop > 0) || entry === stop) {
      out.innerHTML = '<p class="small muted">Introduce entrada y stop (o pulsa «Usar la señal actual»).</p>';
      return;
    }
    const r = RK.positionSize({ capital, riskPct, entry, stop, target: target > 0 ? target : null, feePct: feeFor(), maxLeverage: lev, stepSize: state.info ? state.info.stepSize : 0, minNotional: state.info ? state.info.minNotional : 0 });
    if (!r) {
      out.innerHTML = '<p class="small muted">Datos no válidos.</p>';
      return;
    }
    const dir = stop < entry ? 'compra (largo)' : 'venta (corto)';
    const base = state.info ? state.info.base : 'unidades';
    const quote = state.info ? state.info.quote : '';
    let html = '<div class="cards">';
    html += card('Cantidad', nf(r.qty, state.info && state.info.qtyDecimals != null ? state.info.qtyDecimals : 6), `${esc(base)} · operación de ${dir}`);
    html += card('Valor de la posición', nf(r.notional), `${esc(quote)} · apalancamiento ${nf(r.leverage, 2)}×`);
    html += card('Pérdida si salta el stop', '−' + nf(r.lossAtStop), `${nf((r.lossAtStop / capital) * 100, 2)} % del capital, comisiones incluidas (${nf(r.stopPct, 2)} % de distancia)`, 'down');
    if (r.gainAtTarget != null) html += card('Ganancia en el objetivo', '+' + nf(r.gainAtTarget), `R:R real con comisiones: ${nf(r.gainAtTarget / r.lossAtStop, 2)}`, 'up');
    html += '</div>';
    if (r.capped) html += '<div class="callout">El tamaño está limitado por el apalancamiento máximo: arriesgas menos de lo indicado.</div>';
    if (r.belowMin) html += `<div class="callout">La posición es menor que el mínimo de Binance para este par (${nf(state.info.minNotional)} ${esc(quote)}).</div>`;
    if (r.leverage > 3) html += '<div class="callout">Apalancamiento alto: un movimiento brusco o un hueco de precio puede hacerte perder bastante más de lo previsto.</div>';
    if (isFx()) {
      const L = F.lotSize({ symbol: settings.symbol, capital, riskPct, entry, stop, account: settings.account, rates: state.rates });
      if (L && L.error) html += `<div class="callout">${esc(L.error)}</div>`;
      else if (L) {
        const a = esc(settings.account);
        html += `<h3>En lotes (${esc(settings.symbol)}, cuenta en ${a})</h3><div class="cards">`;
        html += card('Lotes', nf(L.lots, 2), `${Math.round(L.units).toLocaleString('es-ES')} ${esc(base)} · 1 lote estándar = 100 000 · mini 0.1 · micro 0.01`);
        html += card('Stop', nf(L.pips, 1) + ' pips', `1 pip = ${F.pipSize(settings.symbol)}`);
        html += card('Valor del pip', nf(L.pipValue) + ' ' + a, `${nf(L.pipValueLot)} ${a} por lote estándar`);
        html += card('Exposición', nf(L.notional, 0) + ' ' + a, `apalancamiento ${nf(L.notional / capital, 1)}× sobre el capital`);
        html += '</div>';
      }
    }
    out.innerHTML = html;
  }

  /* ---------- Divisas: sesiones, calendario, fuerza y correlaciones ---------- */
  const CORR_PAIRS = ['EUR/USD', 'GBP/USD', 'AUD/USD', 'NZD/USD', 'USD/JPY', 'USD/CHF', 'USD/CAD', 'EUR/GBP'];

  async function loadForexData(force) {
    if (force || !state.ecbSeries || Date.now() - state.ecbAt > 3 * 3600e3) {
      try {
        state.ecbSeries = await FEEDS.ecb.series(Date.now() - 140 * 86400e3, null, F.MAJORS.filter((c) => c !== 'EUR'));
        state.rates = await FEEDS.ecb.latest();
        store.set('fx.rates', state.rates);
        state.ecbAt = Date.now();
        state.ecbErr = null;
      } catch (e) {
        state.ecbErr = e.message || String(e);
      }
    }
    if (force || !state.calendar || Date.now() - state.calAt > 3600e3) {
      try {
        state.calendar = await FEEDS.calendar.week();
        state.calAt = Date.now();
        state.calendarErr = null;
      } catch (e) {
        state.calendarErr = e.message || String(e);
      }
    }
    renderSignal();
    if (state.tab === 'forex') renderForex();
  }

  function mins(m) {
    if (m == null) return '—';
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    const mm = m % 60;
    return (d ? d + ' d ' : '') + (h ? h + ' h ' : '') + (d ? '' : mm + ' min');
  }

  function renderSessions() {
    const box = $('#fx-sessions');
    if (!box) return;
    const S = F.sessions(new Date());
    let html = `<p class="small">${esc(S.note)}</p><div class="table-wrap"><table class="table"><thead><tr><th>Sesión</th><th>Horario local de la plaza</th><th>Estado</th><th>Cambia en</th></tr></thead><tbody>`;
    for (const x of S.list) html += `<tr><td>${x.name}</td><td class="num">${String(x.open).padStart(2, '0')}:00–${x.close}:00</td><td><span class="chip ${x.isOpen ? 'up' : ''}">${x.isOpen ? 'abierta' : 'cerrada'}</span></td><td class="num">${x.isOpen ? 'cierra en ' : 'abre en '}${mins(x.changeIn)}</td></tr>`;
    box.innerHTML = html + '</tbody></table></div>';
  }

  function renderForex() {
    const el = $('#tab-forex');
    const sym = settings.symbol;
    const mine = F.currenciesOf(sym);
    let html = '<h2>Mercado de divisas</h2>';
    html += '<h3>Sesiones</h3><div id="fx-sessions"></div>';

    // Calendario económico
    const onlyMine = settings.fxCalMine !== false;
    const minLevel = settings.fxImpact == null ? 2 : settings.fxImpact;
    html += `<h3>Calendario económico (esta semana)</h3><div class="row"><label class="check"><input type="checkbox" id="fx-cal-mine" ${onlyMine ? 'checked' : ''}> <span>Solo ${mine.length ? mine.join(' y ') : 'las divisas del par'}</span></label><label class="fld inline"><span>Impacto</span><select id="fx-impact"><option value="3">Alto</option><option value="2">Medio y alto</option><option value="0">Todos</option></select></label></div>`;
    if (state.calendarErr) html += `<div class="callout">No se pudo cargar el calendario: ${esc(state.calendarErr)} Algunos navegadores bloquean este servicio; consúltalo en <a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener">forexfactory.com/calendar</a>.</div>`;
    else if (!state.calendar) html += '<p class="small muted">Cargando calendario…</p>';
    else {
      const now = Date.now();
      const evs = F.upcoming(state.calendar, onlyMine ? mine : null, now, { minLevel, pastMs: 12 * 3600e3 });
      if (!evs.length) html += '<p class="small muted">Sin eventos con esos filtros en lo que queda de semana.</p>';
      else {
        html += '<div class="table-wrap"><table class="table"><thead><tr><th>Fecha (tu hora)</th><th>Divisa</th><th>Impacto</th><th>Evento</th><th class="num">Previsión</th><th class="num">Anterior</th></tr></thead><tbody>';
        for (const e of evs) {
          const past = e.t < now;
          const soon = !past && e.t - now < 24 * 3600e3;
          const chip = e.level >= 3 ? 'down' : e.level === 2 ? 'warn' : '';
          html += `<tr style="${past ? 'opacity:.5' : soon ? 'font-weight:600' : ''}"><td>${when(e.t)}</td><td class="num">${esc(e.country)}</td><td><span class="chip ${chip}">${{ 3: 'alto', 2: 'medio', 1: 'bajo', 0: 'festivo' }[e.level]}</span></td><td>${esc(e.title)}</td><td class="num">${esc(e.forecast || '—')}</td><td class="num">${esc(e.previous || '—')}</td></tr>`;
        }
        html += '</tbody></table></div><p class="small muted">Fuente: Forex Factory. En negrita, lo que llega en menos de 24 h.</p>';
      }
    }

    // Fuerza relativa
    const n = settings.fxStrN || 5;
    html += `<h3>Fuerza de las divisas</h3><div class="row"><label class="fld inline"><span>Periodo</span><select id="fx-str-n"><option value="1">1 día</option><option value="5">1 semana</option><option value="20">1 mes</option><option value="60">3 meses</option></select></label></div>`;
    if (state.ecbErr) html += `<div class="callout">No se pudieron cargar los tipos del BCE: ${esc(state.ecbErr)}</div>`;
    else if (!state.ecbSeries) html += '<p class="small muted">Cargando tipos del BCE…</p>';
    else {
      const st = F.strength(state.ecbSeries, n);
      if (st) {
        const max = Math.max(...st.map((x) => Math.abs(x.pct)), 0.01);
        html += '<div class="strength">' + st.map((x) => {
          const w = (Math.abs(x.pct) / max) * 50;
          return `<div class="srow${mine.includes(x.currency) ? ' mine' : ''}"><span class="num">${x.currency}</span><div class="strack"><b style="${x.pct >= 0 ? 'left:50%' : 'right:50%'};width:${w}%;background:var(${x.pct >= 0 ? '--up' : '--down'})"></b></div><span class="num ${x.pct >= 0 ? 'up' : 'down'}">${pct(x.pct)}</span></div>`;
        }).join('') + '</div>';
        const top = st[0];
        const bot = st[st.length - 1];
        html += `<p class="small muted">Cambio medio de cada divisa frente a las otras siete (tipos de referencia del BCE, ${state.ecbSeries[state.ecbSeries.length - 1].date}). Las tendencias más limpias suelen aparecer al enfrentar una divisa fuerte con una débil: ahora, ${top.currency} frente a ${bot.currency}.</p>`;
      }
      // Correlaciones
      const M = F.correlations(state.ecbSeries, CORR_PAIRS, 60);
      html += '<h3>Correlaciones (60 días, rentabilidades diarias)</h3><div class="table-wrap"><table class="table corr"><thead><tr><th></th>' + CORR_PAIRS.map((p) => `<th class="num">${p.replace('/', '')}</th>`).join('') + '</tr></thead><tbody>';
      M.forEach((row, i) => {
        html += `<tr><th>${CORR_PAIRS[i].replace('/', '')}</th>` + row.map((v, j) => {
          const a = Math.min(1, Math.abs(v));
          const bg = i === j ? 'var(--cell)' : `color-mix(in srgb, var(${v >= 0 ? '--up' : '--down'}) ${Math.round(a * 55)}%, transparent)`;
          return `<td class="num" style="background:${bg}">${nf(v, 2)}</td>`;
        }).join('') + '</tr>';
      });
      html += '</tbody></table></div><p class="small muted">Cerca de +1: se mueven juntos (comprar ambos duplica el riesgo). Cerca de −1: se mueven al revés (comprar uno y vender el otro también lo duplica).</p>';
    }

    // Fuentes
    const td = settings.tdKey ? 'clave configurada' : 'sin clave (añádela en Ajustes para velas intradía de divisas y oro)';
    html += '<h3>Fuentes de datos</h3><ul class="rules">';
    html += `<li><strong>Binance</strong>: criptomonedas y pares de monedas estables frente a monedas nacionales (EURUSDT, USDTTRY…), en directo.</li>`;
    html += `<li><strong>Twelve Data</strong>: velas intradía de cualquier par de divisas y del oro (XAU/USD) — ${td}. <a href="https://twelvedata.com/pricing" target="_blank" rel="noopener">Clave gratuita</a>: 800 consultas al día.</li>`;
    html += `<li><strong>BCE (Frankfurter)</strong>: tipos de referencia diarios de ~30 divisas desde 1999, sin clave — ${state.ecbErr ? 'no disponible' : state.ecbSeries ? 'conectado' : 'cargando'}.</li>`;
    html += `<li><strong>Forex Factory</strong>: calendario económico de la semana — ${state.calendarErr ? 'no disponible' : state.calendar ? 'conectado' : 'cargando'}.</li>`;
    html += '</ul>';
    el.innerHTML = html;
    renderSessions();
    $('#fx-impact').value = String(minLevel);
    $('#fx-str-n') && ($('#fx-str-n').value = String(n));
    $('#fx-cal-mine').onchange = (e) => {
      settings.fxCalMine = e.target.checked;
      save();
      renderForex();
    };
    $('#fx-impact').onchange = (e) => {
      settings.fxImpact = +e.target.value;
      save();
      renderForex();
    };
    if ($('#fx-str-n')) $('#fx-str-n').onchange = (e) => {
      settings.fxStrN = +e.target.value;
      save();
      renderForex();
    };
  }

  function fillRiskFromSignal() {
    const cur = state.cur;
    if (!cur) return;
    $('#rk-capital').value = settings.capital;
    $('#rk-risk').value = settings.riskPct;
    if (cur.dir) {
      $('#rk-entry').value = fp(cur.entry);
      $('#rk-stop').value = fp(cur.stop);
      $('#rk-target').value = fp(cur.target);
    } else {
      const e = cur.price;
      const d = settings.atrStop * cur.atr;
      $('#rk-entry').value = fp(e);
      $('#rk-stop').value = fp(e - d);
      $('#rk-target').value = fp(e + settings.rr * d);
    }
    renderRisk();
  }

  /* ---------- Tablero de señales ---------- */
  const BOARD_MAX = 400;
  function saveBoard() {
    const act = state.board.filter((r) => r.status === 'activa');
    const done = state.board.filter((r) => r.status !== 'activa');
    state.board = act.concat(done).sort((a, b) => b.t - a.t || b.at - a.at).slice(0, BOARD_MAX);
    store.set('fx.board', state.board);
  }

  /* Anota las señales nuevas de las últimas `recent` velas de un par y
   * actualiza el estado de sus señales abiertas con las velas recibidas. */
  function recordSignals(sym, iv, candles, evals, source, dec, recent) {
    if (!evals.length) return;
    const minI = evals[evals.length - 1].i - (recent || 0);
    let changed = false;
    evals.forEach((e, k) => {
      if (!e.dir || e.i < minI || !SG.isFresh(evals, k)) return;
      const id = UNI.signalId(sym, iv, e.t, e.dir);
      if (state.board.some((r) => r.id === id)) return;
      const side = e.dir > 0 ? e.long : e.short;
      state.board.unshift({
        id, sym, iv, dir: e.dir, t: e.t, entry: e.entry, stop: e.stop, target: e.target, rr: e.rr, score: e.score, strength: e.strength,
        reasons: side.reasons.filter((x) => x.trigger).sort((a, b) => b.w - a.w).slice(0, 3).map((x) => x.text),
        source, at: Date.now(), dec, status: 'activa', r: 0, last: e.price,
      });
      changed = true;
    });
    state.board = state.board.map((r) => {
      if (r.sym !== sym || r.iv !== iv || r.status !== 'activa') return r;
      changed = true;
      return Object.assign(UNI.trackSignal(r, candles, 48), { upd: Date.now() });
    });
    if (!changed) return;
    saveBoard();
    if (state.tab === 'signals') renderSignals();
  }

  // Abre un par en el gráfico (y opcionalmente una pestaña).
  function openPair(sym, iv, tab) {
    settings.symbol = sym;
    $('#symbol').value = sym;
    const feed = feedFor(sym);
    if (iv && (!feed || feed.intervals.includes(iv))) {
      settings.interval = iv;
      $('#interval').value = iv;
    }
    save();
    if (tab) showTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (state.demo) startDemo();
    else load();
  }

  function ago(t) {
    const m = Math.round((Date.now() - t) / 60e3);
    if (m < 60) return `hace ${Math.max(1, m)} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
  }

  function renderSignals() {
    const el = $('#tab-signals');
    const f = settings.sigFilter;
    const st = UNI.boardStats(state.board);
    let list = state.board.slice();
    if (f.dir !== 'all') list = list.filter((r) => String(r.dir) === f.dir);
    if (f.status === 'activa') list = list.filter((r) => r.status === 'activa');
    else if (f.status === 'cerradas') list = list.filter((r) => r.status !== 'activa');
    if (f.market === 'forex') list = list.filter((r) => F.isForex(r.sym));
    else if (f.market === 'binance') list = list.filter((r) => !F.isForex(r.sym));
    const running = state.uni.running || state.scanning;
    let html = `<div class="row wrap-row"><h2>Señales de compra y venta</h2><button class="btn small primary" type="button" id="sig-refresh" ${running ? 'disabled' : ''}>${running ? 'Analizando…' : 'Analizar todo ahora'}</button><button class="btn small" type="button" id="sig-clear">Borrar cerradas</button></div>`;
    html += '<p class="small muted">Todas las señales detectadas en el gráfico, en tu lista del escáner y en el análisis de pares de la pestaña Mercados. Cada señal se sigue sola: sigue activa hasta que toca el objetivo, el stop o pasan 48 velas.</p>';
    html += '<div class="cards">';
    html += card('Activas', `${st.active}`, `<span class="up">${st.activeLong} de compra</span> · <span class="down">${st.activeShort} de venta</span>`);
    html += card('Cerradas', `${st.resolved}`, `${st.wins} en objetivo · ${st.losses} en stop · ${st.expired} caducadas`);
    html += card('Acierto', ppc(st.winRate), st.wins + st.losses ? `objetivo frente a stop (con R:R ${nf(settings.rr, 1)} basta un ${ppc(1 / (1 + settings.rr))})` : 'aún sin señales cerradas', st.winRate > 1 / (1 + settings.rr) ? 'up' : st.wins + st.losses ? 'down' : '');
    html += card('Resultado medio', ok(st.avgR) ? (st.avgR > 0 ? '+' : '') + nf(st.avgR, 2) + ' R' : '—', st.first ? 'por señal cerrada, desde ' + when(st.first) : '', st.avgR > 0 ? 'up' : st.avgR < 0 ? 'down' : '');
    html += '</div>';
    html += `<div class="row"><label class="fld inline"><span>Sentido</span><select id="sig-dir"><option value="all">Todas</option><option value="1">Compra</option><option value="-1">Venta</option></select></label>
      <label class="fld inline"><span>Estado</span><select id="sig-status"><option value="activa">Activas</option><option value="cerradas">Cerradas</option><option value="all">Todas</option></select></label>
      <label class="fld inline"><span>Mercado</span><select id="sig-market"><option value="all">Todos</option><option value="forex">Divisas</option><option value="binance">Binance</option></select></label></div>`;
    if (!list.length) html += `<p class="muted">${state.board.length ? 'Ninguna señal con esos filtros.' : 'Todavía no hay señales registradas. Pulsa «Analizar todo ahora» o abre la pestaña Mercados para analizar todos los pares.'}</p>`;
    else {
      const chipSt = { activa: '', objetivo: 'up', stop: 'down', caducada: 'warn' };
      html += '<div class="table-wrap"><table class="table"><thead><tr><th>Vela de la señal</th><th>Par</th><th>Sentido</th><th class="num">Entrada</th><th class="num">Stop</th><th class="num">Objetivo</th><th class="num">Último</th><th class="num">Resultado</th><th>Estado</th><th>Confluencia</th><th>Origen</th><th></th></tr></thead><tbody>';
      for (const r of list.slice(0, 200)) {
        const d = r.dec;
        html += `<tr class="click" data-open="${esc(r.sym)}" data-iv="${esc(r.iv)}" title="${esc(r.reasons.join(' · '))}">
          <td>${when(r.t)}<br><span class="small muted">${ago(r.at)}</span></td>
          <td class="num"><strong>${esc(r.sym)}</strong><br><span class="small muted">${IV[r.iv] || esc(r.iv)}</span></td>
          <td><span class="chip ${r.dir > 0 ? 'up' : 'down'}">${r.dir > 0 ? 'COMPRA' : 'VENTA'}</span></td>
          <td class="num">${U.fmtPrice(r.entry, d)}</td><td class="num down">${U.fmtPrice(r.stop, d)}</td><td class="num up">${U.fmtPrice(r.target, d)}</td>
          <td class="num">${U.fmtPrice(r.last, d)}</td>
          <td class="num ${r.r > 0 ? 'up' : r.r < 0 ? 'down' : ''}">${(r.r > 0 ? '+' : '') + nf(r.r, 2)} R</td>
          <td><span class="chip ${chipSt[r.status]}">${r.status === 'objetivo' ? 'objetivo' : r.status}</span></td>
          <td>${esc(r.strength || '')} <span class="small muted">${nf(r.score, 1)}</span></td>
          <td class="small">${esc(r.source)}</td>
          <td><button class="btn small" type="button" data-prospect="${esc(r.sym)}" data-iv="${esc(r.iv)}">Prospecto</button></td></tr>`;
      }
      html += '</tbody></table></div>';
    }
    html += '<p class="small muted">«Resultado» en R: múltiplos de lo arriesgado (−1 R = stop). En las activas es el resultado latente al último precio. Las señales son probabilísticas; el historial te dice cuánto aciertan de verdad.</p>';
    el.innerHTML = html;
    $('#sig-dir').value = f.dir;
    $('#sig-status').value = f.status;
    $('#sig-market').value = f.market;
    for (const [id, key] of [['#sig-dir', 'dir'], ['#sig-status', 'status'], ['#sig-market', 'market']]) {
      $(id).onchange = (e) => {
        settings.sigFilter[key] = e.target.value;
        save();
        renderSignals();
      };
    }
    $('#sig-refresh').onclick = () => {
      scanAll();
      if (state.uni.series) analyzePairs();
      else loadUniverse(true);
      renderSignals();
    };
    $('#sig-clear').onclick = () => {
      state.board = state.board.filter((r) => r.status === 'activa');
      saveBoard();
      renderSignals();
    };
    el.querySelector('tbody') && el.querySelector('tbody').addEventListener('click', (e) => {
      const pr = e.target.closest('[data-prospect]');
      if (pr) return openPair(pr.dataset.prospect, pr.dataset.iv, 'prospect');
      const row = e.target.closest('tr[data-open]');
      if (row) openPair(row.dataset.open, row.dataset.iv);
    });
  }

  /* ---------- Mercados: índice de divisas y análisis de pares ---------- */
  async function loadUniverse(force) {
    const u = state.uni;
    if (u.loading) return;
    if (!force && u.index && Date.now() - u.at < 30 * 60e3) return renderMarkets();
    u.loading = true;
    u.err = {};
    renderMarkets();
    await Promise.all([
      FEEDS.ecb.range(720, null).then((x) => (u.series = x), (e) => (u.err.ecb = e.message)),
      (async () => {
        const syms = await API.exchangeInfoAll();
        u.binSymbols = syms;
        const f = UNI.binanceFiat(syms);
        u.binUsd = Object.keys(f.currencies).filter((c) => f.currencies[c].usdPair).map((c) => Object.assign({ code: c }, f.currencies[c].usdPair));
        await Promise.all(u.binUsd.map(async (p) => {
          try {
            u.binHist[p.code] = await API.klines(p.symbol, '1d', 400);
          } catch (e) {
            /* ese par no tiene historia diaria */
          }
        }));
      })().catch((e) => (u.err.binance = e.message || String(e))),
      FEEDS.tdForexPairs(settings.tdKey).then((x) => (u.tdPairs = x), (e) => (u.err.td = e.message || String(e))),
    ]);
    u.index = UNI.buildIndex({ ecb: u.series, binance: u.binSymbols ? { symbols: u.binSymbols, histories: u.binHist } : null, twelve: u.tdPairs });
    u.at = Date.now();
    u.loading = false;
    renderMarkets();
    if (state.tab === 'prospect') renderProspect();
    if (!u.running) analyzePairs();
  }

  async function analyzePairs() {
    const u = state.uni;
    if (u.running) return;
    if (!u.series && !(u.binUsd && u.binUsd.length)) return;
    const codes = u.series ? ['EUR'].concat(Object.keys(u.series[u.series.length - 1].rates)) : [];
    const jobs = UNI.buildPairs(settings.uniMode, codes, u.focus).map((p) => ({ sym: p, src: 'BCE' }));
    if (settings.uniBinance && u.binUsd) u.binUsd.forEach((p) => u.binHist[p.code] && (!u.focus || p.code === u.focus) && jobs.push({ sym: p.symbol, src: 'Binance', code: p.code }));
    u.running = true;
    u.results = [];
    u.progress = [0, jobs.length];
    renderMarkets();
    const fresh = [];
    for (let k = 0; k < jobs.length; k++) {
      const j = jobs[k];
      try {
        const C = j.src === 'BCE' ? FEEDS.ecb.fixingsToCandles(u.series, j.sym) : u.binHist[j.code];
        if (!C || C.length < SG.MIN_BARS + 10) throw new Error('Pocas velas');
        const ctx = SG.analyze(C, { interval: '1d' });
        const li = U.lastClosed(C);
        const dec = F.isForex(j.sym) ? F.decimals(j.sym) : U.autoDecimals(C[li].c);
        const evs = SG.evaluateRange(ctx, sigOpts(dec, j.sym), li - 5 - SG.COOLDOWN, li);
        const r = evs[evs.length - 1];
        let recent = null;
        for (let q = evs.length - 1; q >= 0 && !recent; q--) if (SG.isFresh(evs, q) && evs[q].i >= li - 5) recent = evs[q];
        const cl = (n) => (li - n >= 0 ? (C[li].c / C[li - n].c - 1) * 100 : NaN);
        u.results.push({ sym: j.sym, src: j.src, price: C[C.length - 1].c, chg1: cl(1), chg5: cl(j.src === 'BCE' ? 5 : 7), trend: r.trend, rsi: r.snap.rsi, long: r.long.score, short: r.short.score, dir: r.dir, bias: r.bias, recent: recent ? { dir: recent.dir, ago: li - recent.i } : null, dec, strength: r.strength });
        if (!state.demo) recordSignals(j.sym, '1d', C, evs, 'mercados', dec, 5);
        if (r.dir && SG.isFresh(evs, evs.length - 1) && alertSignal(j.sym, '1d', r, dec, 'mercados', true)) fresh.push(j.sym + ' ' + (r.dir > 0 ? 'compra' : 'venta'));
      } catch (e) {
        u.results.push({ sym: j.sym, src: j.src, err: e.message || String(e) });
      }
      u.progress[0] = k + 1;
      if (k % 4 === 3) {
        renderPairsProgress();
        await sleep(0);
      }
    }
    u.running = false;
    u.resultsAt = Date.now();
    if (fresh.length) {
      const title = `${fresh.length} señal${fresh.length > 1 ? 'es' : ''} nueva${fresh.length > 1 ? 's' : ''} en Mercados`;
      const body = fresh.slice(0, 6).join(' · ') + (fresh.length > 6 ? ' …' : '');
      toast(title, ' ' + body, 0);
      beep(1);
      notify(title, body, 'mercados');
      if (window.radarDesktop) window.radarDesktop.alert(title);
    }
    renderMarkets();
    if (state.tab === 'signals') renderSignals();
  }

  function renderPairsProgress() {
    const b = $('#uni-progress');
    if (!b) return;
    const [d, t] = state.uni.progress;
    b.hidden = !state.uni.running;
    $('i', b).style.width = (t ? (d / t) * 100 : 0) + '%';
    $('span', b).textContent = `Analizando ${d} de ${t} pares…`;
  }

  // Esqueleto fijo de la pestaña (el buscador no pierde el foco al refrescar los datos).
  function marketsSkeleton() {
    const el = $('#tab-markets');
    if ($('#uni-head', el)) return;
    el.innerHTML = `<div class="row wrap-row"><h2>Mercados de divisas</h2><button class="btn small" type="button" id="uni-refresh">Actualizar</button></div>
      <div id="uni-head"></div>
      <h3>Índice de divisas</h3>
      <div class="row"><input id="uni-q" placeholder="Buscar: código, divisa o país" spellcheck="false">
        <label class="fld inline"><span>Tipo</span><select id="uni-type"><option value="all">Todas</option><option value="majors">Las 8 principales</option><option value="fiat">Monedas nacionales</option><option value="metal">Metales</option><option value="monitor">Con datos de precio</option></select></label>
        <label class="fld inline"><span>Región</span><select id="uni-region"><option value="all">Todas</option></select></label></div>
      <div id="uni-idx" class="table-wrap"></div>
      <h3>Mapa de calor (1 semana)</h3><div id="uni-heat" class="table-wrap"></div>
      <h3>Pares para operar</h3>
      <div class="row"><label class="fld inline"><span>Pares</span><select id="uni-mode"><option value="majors">Cruces de las 8 principales (28)</option><option value="majors+usd">Principales + el resto frente a USD y EUR</option><option value="all">Todas las combinaciones</option></select></label>
        <label class="check"><input type="checkbox" id="uni-bin"> <span>Incluir monedas nacionales de Binance</span></label>
        <button class="btn small primary" type="button" id="uni-run">Analizar pares</button><span id="uni-focus"></span></div>
      <div class="progress-bar" id="uni-progress" hidden><i></i><span></span></div>
      <div id="uni-pairs" class="table-wrap"></div>
      <p class="small muted">Los pares del BCE se analizan con velas diarias (operaciones de varios días). Para intradía, abre el par con una clave de Twelve Data. Pulsa una fila para verla en el gráfico.</p>`;
    $('#uni-refresh').onclick = () => loadUniverse(true);
    $('#uni-q').oninput = () => renderIndexTable();
    $('#uni-type').onchange = () => renderIndexTable();
    $('#uni-region').onchange = () => renderIndexTable();
    $('#uni-mode').value = settings.uniMode;
    $('#uni-bin').checked = settings.uniBinance;
    $('#uni-mode').onchange = (e) => {
      settings.uniMode = e.target.value;
      state.uni.focus = null;
      save();
      analyzePairs();
    };
    $('#uni-bin').onchange = (e) => {
      settings.uniBinance = e.target.checked;
      save();
      analyzePairs();
    };
    $('#uni-run').onclick = () => analyzePairs();
    $('#uni-idx').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const s = state.uni.idxSort;
        s.dir = s.key === th.dataset.sort ? -s.dir : -1;
        s.key = th.dataset.sort;
        return renderIndexTable();
      }
      const b = e.target.closest('[data-focus]');
      if (b) {
        state.uni.focus = b.dataset.focus;
        analyzePairs();
        $('#uni-pairs').scrollIntoView({ behavior: 'smooth' });
      }
    });
    $('#uni-pairs').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const s = state.uni.sort;
        s.dir = s.key === th.dataset.sort ? -s.dir : -1;
        s.key = th.dataset.sort;
        return renderPairsTable();
      }
      const add = e.target.closest('[data-watch]');
      if (add) {
        if (!settings.watch.includes(add.dataset.watch) && settings.watch.length < 25) settings.watch.push(add.dataset.watch);
        save();
        add.disabled = true;
        add.textContent = '✓';
        return;
      }
      const pr = e.target.closest('[data-prospect]');
      if (pr) return openPair(pr.dataset.prospect, '1d', 'prospect');
      const row = e.target.closest('tr[data-open]');
      if (row) openPair(row.dataset.open, '1d');
    });
  }

  function renderMarkets() {
    marketsSkeleton();
    const u = state.uni;
    if (!u.index && !u.loading) {
      loadUniverse();
      return;
    }
    const c = u.index ? u.index.counts : null;
    const err = Object.keys(u.err).map((k) => `${{ ecb: 'BCE', binance: 'Binance', td: 'Twelve Data' }[k]}: ${esc(u.err[k])}`);
    let head = '';
    if (u.loading) head += '<p class="muted">Buscando e indexando las divisas en el BCE, Binance y Twelve Data…</p>';
    if (c) head += `<div class="cards"><div class="card"><div class="k">Divisas indexadas</div><div class="v">${c.total}</div><p>en ${[c.ecb && 'BCE', c.binance && 'Binance', c.td && 'Twelve Data'].filter(Boolean).join(', ') || 'ninguna fuente'}</p></div>
      <div class="card"><div class="k">BCE</div><div class="v">${c.ecb}</div><p>tipos de referencia diarios</p></div>
      <div class="card"><div class="k">Binance</div><div class="v">${c.binance}</div><p>monedas nacionales en ${c.binancePairs} pares</p></div>
      <div class="card"><div class="k">Twelve Data</div><div class="v">${c.td}</div><p>${c.tdPairs} pares de divisas</p></div></div>`;
    if (err.length) head += `<div class="callout">Algunas fuentes no respondieron: ${err.join(' · ')}</div>`;
    if (u.at) head += `<p class="small muted">Actualizado ${ago(u.at)}. Se vuelve a comprobar cada 30 minutos mientras la app esté abierta.</p>`;
    $('#uni-head').innerHTML = head;
    const regions = u.index ? Array.from(new Set(u.index.list.map((x) => x.region))).sort() : [];
    const rs = $('#uni-region');
    if (rs.options.length !== regions.length + 1) {
      const cur = rs.value;
      rs.innerHTML = '<option value="all">Todas</option>' + regions.map((r) => `<option>${esc(r)}</option>`).join('');
      rs.value = regions.includes(cur) ? cur : 'all';
    }
    renderIndexTable();
    renderHeatmap();
    renderPairsTable();
    renderPairsProgress();
  }

  function sorter(key, dir, get) {
    return (a, b) => {
      const x = get(a, key);
      const y = get(b, key);
      if (typeof x === 'string' || typeof y === 'string') return dir * String(x).localeCompare(String(y));
      const fx = Number.isFinite(x) ? x : -Infinity;
      const fy = Number.isFinite(y) ? y : -Infinity;
      return dir * (fx - fy);
    };
  }

  function renderIndexTable() {
    const box = $('#uni-idx');
    const u = state.uni;
    if (!box || !u.index) return;
    const q = $('#uni-q').value.trim().toLowerCase();
    const type = $('#uni-type').value;
    const region = $('#uni-region').value;
    let list = u.index.list.filter((x) => (!q || (x.code + ' ' + x.name + ' ' + x.country).toLowerCase().includes(q)) && (region === 'all' || x.region === region));
    if (type === 'majors') list = list.filter((x) => F.MAJORS.includes(x.code));
    else if (type === 'fiat' || type === 'metal') list = list.filter((x) => x.type === type);
    else if (type === 'monitor') list = list.filter((x) => x.m);
    const s = u.idxSort;
    const get = (x, k) => (k === 'code' ? x.code : k === 'strength' ? x.strength : k === 'pairs' ? x.pairs.binance + x.pairs.td : x.m ? x.m[k] : NaN);
    list.sort(sorter(s.key, s.dir, get));
    const th = (k, label, cls) => `<th class="${cls || ''}" data-sort="${k}" style="cursor:pointer">${label}${s.key === k ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const cell = (v, d) => `<td class="num ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${ok(v) ? pct(v, d == null ? 2 : d) : '—'}</td>`;
    let html = `<table class="table"><thead><tr>${th('code', 'Divisa')}<th>País o zona</th><th>Fuentes</th>${th('pairs', 'Pares', 'num')}${th('last', '1 unidad en USD', 'num')}${th('chg1', '1 día', 'num')}${th('chg5', '1 semana', 'num')}${th('chg21', '1 mes', 'num')}${th('strength', 'Fuerza (sem.)', 'num')}${th('vol', 'Volatilidad', 'num')}<th>Tendencia</th><th></th></tr></thead><tbody>`;
    for (const x of list) {
      const m = x.m;
      const src = [x.sources.ecb && 'BCE', x.sources.binance && 'Binance', x.sources.td && 'TD'].filter(Boolean).map((t) => `<span class="chip">${t}</span>`).join(' ');
      const usd = m && ok(m.last) ? (m.last >= 1 ? nf(m.last, 4) : m.last >= 0.01 ? nf(m.last, 5) : m.last.toPrecision(3)) : '—';
      html += `<tr><td><strong class="num">${esc(x.code)}</strong> <span class="small">${esc(x.name)}</span></td><td class="small">${esc(x.country)}</td><td>${src}</td><td class="num">${x.pairs.binance + x.pairs.td || '—'}</td><td class="num">${usd}</td>${cell(m && m.chg1)}${cell(m && m.chg5)}${cell(m && m.chg21)}${cell(x.strength)}<td class="num">${m && m.vol ? nf(m.vol, 1) + ' %' : '—'}</td><td>${m ? `<span class="${m.trend === 'alcista' ? 'up' : m.trend === 'bajista' ? 'down' : ''}">${m.trend}</span>` : '—'}</td><td>${x.sources.ecb || x.sources.binance ? `<button class="btn small" type="button" data-focus="${esc(x.code)}">Pares</button>` : ''}</td></tr>`;
    }
    html += '</tbody></table>';
    box.innerHTML = list.length ? html : '<p class="muted">Sin divisas con esos filtros.</p>';
  }

  function renderHeatmap() {
    const box = $('#uni-heat');
    const u = state.uni;
    if (!box) return;
    const series = u.series || state.ecbSeries;
    const codes = F.MAJORS;
    const M = series ? UNI.heatmap(series, codes, 5) : null;
    if (!M) {
      box.innerHTML = '<p class="small muted">Sin datos del BCE.</p>';
      return;
    }
    const max = Math.max(...M.flat().filter(ok).map(Math.abs), 0.1);
    let html = '<table class="table corr"><thead><tr><th>Base \\ Cotizada</th>' + codes.map((c) => `<th class="num">${c}</th>`).join('') + '</tr></thead><tbody>';
    M.forEach((row, a) => {
      html += `<tr><th>${codes[a]}</th>` + row.map((v, b) => {
        if (!ok(v)) return '<td style="background:var(--cell)"></td>';
        const al = Math.round((Math.abs(v) / max) * 60);
        return `<td class="num" style="background:color-mix(in srgb, var(${v >= 0 ? '--up' : '--down'}) ${al}%, transparent)" title="${codes[a]}/${codes[b]}">${pct(v, 2)}</td>`;
      }).join('') + '</tr>';
    });
    box.innerHTML = html + '</tbody></table><p class="small muted">Cambio de cada divisa de la fila frente a la de la columna en la última semana. Las filas más verdes son las divisas más fuertes.</p>';
  }

  function renderPairsTable() {
    const box = $('#uni-pairs');
    const u = state.uni;
    if (!box) return;
    $('#uni-run').disabled = u.running || (!u.series && !(u.binUsd && u.binUsd.length));
    $('#uni-focus').innerHTML = u.focus ? `<span class="chip">Pares de ${esc(u.focus)} <button class="btn icon" type="button" id="uni-unfocus" aria-label="Quitar filtro" style="min-height:0;height:20px;width:20px">×</button></span>` : '';
    if ($('#uni-unfocus')) $('#uni-unfocus').onclick = () => {
      u.focus = null;
      analyzePairs();
    };
    if (!u.results.length) {
      box.innerHTML = u.running || u.loading ? '' : '<p class="muted">Sin análisis todavía.</p>';
      return;
    }
    const s = u.sort;
    const get = (x, k) => (k === 'opp' ? (x.err ? -1 : (x.dir ? 100 : 0) + Math.max(x.long, x.short)) : k === 'sym' ? x.sym : x[k]);
    const rows = u.results.slice().sort(sorter(s.key, s.dir, get));
    const th = (k, label, cls) => `<th class="${cls || ''}" data-sort="${k}" style="cursor:pointer">${label}${s.key === k ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const withSig = rows.filter((r) => r.dir).length;
    let html = `<p class="small">${rows.length} pares analizados ${u.resultsAt ? ago(u.resultsAt) : ''}: <strong>${withSig}</strong> con señal en la última vela${withSig ? '' : ''}.</p>`;
    html += `<table class="table"><thead><tr>${th('sym', 'Par')}<th>Fuente</th>${th('price', 'Precio', 'num')}${th('chg1', '1 día', 'num')}${th('chg5', '1 semana', 'num')}<th>Tendencia</th>${th('rsi', 'RSI', 'num')}${th('opp', 'Compra / venta', 'num')}<th>Señal</th><th></th></tr></thead><tbody>`;
    for (const r of rows) {
      if (r.err) {
        html += `<tr><td class="num"><strong>${esc(r.sym)}</strong></td><td>${r.src}</td><td colspan="8" class="small muted">${esc(r.err)}</td></tr>`;
        continue;
      }
      const sig = r.dir ? `<span class="chip ${r.dir > 0 ? 'up' : 'down'}">${r.dir > 0 ? 'COMPRA' : 'VENTA'}</span>` : r.recent ? `<span class="small ${r.recent.dir > 0 ? 'up' : 'down'}">${r.recent.dir > 0 ? 'compra' : 'venta'} hace ${r.recent.ago} d</span>` : `<span class="small muted">${r.bias >= 1 ? 'sesgo alcista' : r.bias <= -1 ? 'sesgo bajista' : 'esperar'}</span>`;
      const watched = settings.watch.includes(r.sym);
      html += `<tr class="click" data-open="${esc(r.sym)}"><td class="num"><strong>${esc(r.sym)}</strong></td><td class="small">${r.src}</td><td class="num">${U.fmtPrice(r.price, r.dec)}</td>
        <td class="num ${r.chg1 >= 0 ? 'up' : 'down'}">${pct(r.chg1)}</td><td class="num ${r.chg5 >= 0 ? 'up' : 'down'}">${pct(r.chg5)}</td>
        <td>${r.trend > 0 ? '<span class="up">alcista</span>' : r.trend < 0 ? '<span class="down">bajista</span>' : 'lateral'}</td><td class="num">${nf(r.rsi, 0)}</td>
        <td class="num"><span class="up">${nf(r.long, 1)}</span> / <span class="down">${nf(r.short, 1)}</span></td><td>${sig}</td>
        <td class="row tight"><button class="btn small" type="button" data-prospect="${esc(r.sym)}">Prospecto</button><button class="btn icon" type="button" data-watch="${esc(r.sym)}" ${watched ? 'disabled' : ''} aria-label="Añadir ${esc(r.sym)} al escáner" title="Añadir al escáner">${watched ? '✓' : '+'}</button></td></tr>`;
    }
    box.innerHTML = html + '</tbody></table>';
  }

  /* ---------- Prospecto ---------- */
  async function loadNews(force) {
    if (!force && state.news && Date.now() - state.newsAt < 20 * 60e3) return;
    state.news = await FEEDS.news.load();
    state.news.items = FX.prospect.tagNews(state.news.items);
    state.newsAt = Date.now();
    if (state.tab === 'prospect') renderProspect();
  }

  // Fuerza semanal de cada divisa (BCE) con su puesto, para el prospecto.
  function strengthMap() {
    const series = state.uni.series || state.ecbSeries;
    if (!series) return {};
    const codes = ['EUR'].concat(Object.keys(series[series.length - 1].rates));
    const st = F.strength(series, 5, codes) || [];
    const out = {};
    st.forEach((x, k) => (out[x.currency] = { pct: x.pct, rank: k + 1, of: st.length }));
    return out;
  }

  function renderProspect() {
    const el = $('#tab-prospect');
    const cur = state.cur;
    if (!cur || !cur.snap || !state.ctx) {
      el.innerHTML = '<p class="muted">Cargando el análisis del par…</p>';
      return;
    }
    const sym = settings.symbol;
    const curs = F.currenciesOf(sym);
    const p = FX.prospect.build({
      sym, ctx: state.ctx, cur, proj: state.proj, rr: settings.rr, atrStop: settings.atrStop,
      events: state.calendar ? F.upcoming(state.calendar, curs, Date.now(), { minLevel: 0 }) : null,
      news: state.news ? state.news.items : null, strength: strengthMap(), sentiment: state.sentiment,
      fmt: (x) => fp(x), when, stepLabel: 'velas de ' + (IV[settings.interval] || settings.interval),
    });
    state.prospect = p;
    const cls = p.lean > 0 ? 'buy' : p.lean < 0 ? 'sell' : '';
    let html = `<div class="row wrap-row"><h2>Prospecto de ${esc(sym)}</h2><button class="btn small" type="button" id="pr-copy">Copiar informe</button><button class="btn small" type="button" id="pr-news">Actualizar noticias</button></div>`;
    html += `<p class="small muted">Vela de ${IV[settings.interval]} cerrada ${when(p.t)} · precio ${fp(p.price)}${state.demo ? ' · datos simulados' : ''}</p>`;
    html += `<div class="verdict ${cls}"><div class="k">Prospecto</div><div class="v">${p.word.toUpperCase()}</div><div class="small">Confianza ${p.conf}. ${esc(p.action)}</div></div>`;
    html += '<h3>Factores que pesan</h3><div class="strength">' + p.factors.map((f) => {
      const w = Math.min(50, Math.abs(f.value) * 50);
      return `<div class="srow wide"><span class="small">${esc(f.name)}</span><div class="strack"><b style="${f.value >= 0 ? 'left:50%' : 'right:50%'};width:${w}%;background:var(${f.value >= 0 ? '--up' : '--down'})"></b></div><span class="num ${f.value >= 0 ? 'up' : 'down'}">${f.value >= 0 ? '+' : ''}${nf(f.value, 2)}</span></div>`;
    }).join('') + '</div>';
    for (const sec of p.sections) {
      html += `<h3>${esc(sec.title)}</h3><p>${esc(sec.text)}</p>`;
      if (sec.rows) {
        html += '<div class="table-wrap"><table class="table"><thead><tr><th>Vela</th><th>Tipo</th><th class="num">Apertura</th><th class="num">Cierre</th><th class="num">Cuerpo / ATR</th><th>Lectura</th></tr></thead><tbody>';
        for (const r of sec.rows.slice().reverse()) html += `<tr><td>${when(r.t)}</td><td><span class="chip ${r.type === 'alcista' ? 'up' : r.type === 'bajista' ? 'down' : ''}">${r.type}</span></td><td class="num">${fp(r.o)}</td><td class="num">${fp(r.c)}</td><td class="num">${nf(r.bodyAtr, 2)}</td><td class="small">${esc(r.notes.concat(r.patterns).join(' · ') || '—')}</td></tr>`;
        html += '</tbody></table></div>';
      }
      if (sec.groups) {
        html += '<div class="table-wrap"><table class="table"><thead><tr><th>Escuela</th><th class="num">Compra</th><th class="num">Venta</th></tr></thead><tbody>' + sec.groups.map((g) => `<tr><td>${esc(g.group)}</td><td class="num up">${g.long ? nf(g.long) : '—'}</td><td class="num down">${g.short ? nf(g.short) : '—'}</td></tr>`).join('') + '</tbody></table></div>';
      }
      if (sec.id === 'fundamental') {
        if (sec.events && sec.events.length) html += '<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Divisa</th><th>Impacto</th><th>Evento</th><th class="num">Previsión</th><th class="num">Anterior</th></tr></thead><tbody>' + sec.events.map((e) => `<tr><td>${when(e.t)}</td><td class="num">${esc(e.country)}</td><td><span class="chip ${e.level >= 3 ? 'down' : 'warn'}">${e.level >= 3 ? 'alto' : 'medio'}</span></td><td>${esc(e.title)}</td><td class="num">${esc(e.forecast || '—')}</td><td class="num">${esc(e.previous || '—')}</td></tr>`).join('') + '</tbody></table></div>';
        else if (state.calendarErr) html += `<p class="small muted">Calendario no disponible: ${esc(state.calendarErr)}</p>`;
        if (sec.news && sec.news.length) html += '<ul class="news">' + sec.news.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="small muted">${esc(n.source)}${n.t ? ' · ' + when(n.t) : ''}</span></li>`).join('') + '</ul>';
        else if (state.news) {
          const okSrc = Object.keys(state.news.status).filter((k) => state.news.status[k] === 'ok').length;
          html += `<p class="small muted">${okSrc ? 'Ningún titular reciente menciona estas divisas.' : `No se pudieron leer los canales de noticias${window.radarDesktop ? '' : ' (los navegadores suelen bloquearlos; en la app de escritorio funcionan)'}.`}</p>`;
        } else html += '<p class="small muted">Cargando noticias…</p>';
      }
    }
    html += '<h3>Planes de operación</h3><div class="cards">';
    for (const pl of p.plans) {
      const fx = F.isForex(sym) ? F.lotSize({ symbol: sym, capital: settings.capital, riskPct: settings.riskPct, entry: pl.entry, stop: pl.stop, account: settings.account, rates: state.rates }) : null;
      const ps = !fx ? sizing(pl.entry, pl.stop, pl.target) : null;
      const size = fx && !fx.error ? `${nf(fx.lots, 2)} lotes` : ps ? `${nf(ps.qty, 4)} ${esc((state.info && state.info.base) || '')}` : '—';
      html += `<div class="card${pl.preferred ? ' pref' : ''}"><div class="k">${esc(pl.title)}${pl.preferred ? ' · preferente' : ''}</div>
        <p>Activación: ${esc(pl.trigger)}</p>
        <dl class="kv"><dt>Entrada</dt><dd>${fp(pl.entry)}</dd><dt>Stop</dt><dd class="down">${fp(pl.stop)}</dd><dt>Objetivo</dt><dd class="up">${fp(pl.target)}</dd><dt>R:R</dt><dd>${nf(pl.rr, 1)}</dd>
        <dt>Probabilidad</dt><dd>${ok(pl.prob) ? ppc(pl.prob) : '—'}</dd><dt>Tamaño (${nf(settings.riskPct, 1)} %)</dt><dd>${size}</dd></dl>
        ${ok(pl.prob) ? `<p class="small">${esc(pl.probLabel)}</p>` : ''}</div>`;
    }
    html += '</div>';
    if (p.risks.length) html += '<h3>Riesgos</h3><ul class="rules">' + p.risks.map((r) => `<li>${esc(r)}</li>`).join('') + '</ul>';
    html += '<p class="small muted">Prospecto generado automáticamente con el análisis técnico, la proyección, la fuerza relativa, el calendario y los titulares disponibles. Es probabilístico: no es una predicción ni asesoramiento financiero.</p>';
    el.innerHTML = html;
    $('#pr-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(p.text);
        toast('Informe copiado', ' Pégalo donde quieras (notas, correo…).', 0);
      } catch (e) {
        toast('No se pudo copiar', ' Tu navegador no permite copiar desde aquí.', 0);
      }
    };
    $('#pr-news').onclick = () => loadNews(true);
  }

  /* ---------- Símbolos ---------- */
  async function loadSymbols() {
    const cached = store.get('fx.symbols', null);
    let list = cached && Date.now() - cached.at < 86400e3 ? cached.list : null;
    if (!list) {
      try {
        list = await API.symbols();
        store.set('fx.symbols', { at: Date.now(), list });
      } catch (e) {
        list = (cached && cached.list) || DEFAULT_WATCH;
      }
    }
    $('#symbols').innerHTML = F.PAIRS.concat(list).map((s) => `<option value="${esc(s)}">`).join('');
  }

  /* ---------- Controles ---------- */
  function bindControls() {
    const val = (id, v) => ($(id).value = v);
    val('#symbol', settings.symbol);
    val('#interval', settings.interval);
    val('#profile', settings.profile);
    val('#market', settings.market);
    val('#rr', settings.rr);
    val('#atrStop', settings.atrStop);
    val('#capital', settings.capital);
    val('#riskPct', settings.riskPct);
    val('#fee', settings.fee);
    val('#fxFee', settings.fxFee);
    val('#tdKey', settings.tdKey);
    val('#account', settings.account);
    val('#horizon', settings.horizon);
    val('#lower', settings.lower);
    val('#scan-interval', settings.scanInterval);
    $('#trendFilter').checked = settings.trendFilter;
    $('#mtfFilter').checked = settings.mtfFilter;
    $('#sound').checked = settings.sound;
    $('#scan-on').checked = settings.scanOn;
    $('#rk-capital').value = settings.capital;
    $('#rk-risk').value = settings.riskPct;

    const go = () => {
      const s = normalizeSymbol($('#symbol').value);
      if (!s) return;
      $('#symbol').value = s;
      const changed = s !== settings.symbol;
      settings.symbol = s;
      save();
      if (changed || !state.candles.length || state.demo || !$('#load-error').hidden) load();
    };
    $('#go').onclick = go;
    $('#symbol').addEventListener('change', go);
    $('#symbol').addEventListener('keydown', (e) => e.key === 'Enter' && go());
    $('#interval').onchange = (e) => {
      settings.interval = e.target.value;
      save();
      if (state.demo) startDemo();
      else load();
    };
    const re = () => {
      if (state.candles.length) recompute({ full: true });
    };
    $('#profile').onchange = (e) => {
      settings.profile = e.target.value;
      save();
      re();
    };
    $('#market').onchange = (e) => {
      settings.market = e.target.value;
      save();
      re();
    };
    $('#trendFilter').onchange = (e) => {
      settings.trendFilter = e.target.checked;
      save();
      re();
    };
    $('#mtfFilter').onchange = (e) => {
      settings.mtfFilter = e.target.checked;
      save();
      re();
    };
    const num = (id, key, min, max, recalc) => {
      $(id).addEventListener('change', (e) => {
        const x = parseFloat(e.target.value);
        if (!ok(x)) return (e.target.value = settings[key]);
        settings[key] = Math.max(min, Math.min(max, x));
        e.target.value = settings[key];
        save();
        if (recalc) re();
        else {
          renderSignal();
          if (state.tab === 'risk') renderRisk();
        }
      });
    };
    num('#rr', 'rr', 0.5, 10, true);
    num('#atrStop', 'atrStop', 0.5, 6, true);
    num('#horizon', 'horizon', 4, 96, true);
    num('#capital', 'capital', 1, 1e12, false);
    num('#riskPct', 'riskPct', 0.1, 10, false);
    num('#fee', 'fee', 0, 1, false);
    num('#fxFee', 'fxFee', 0, 1, false);
    $('#tdKey').addEventListener('change', (e) => {
      settings.tdKey = e.target.value.trim();
      save();
      state.scan = {};
      if (isFx()) load();
      if (settings.scanOn) scanAll();
      if (state.tab === 'forex') renderForex();
    });
    $('#account').onchange = (e) => {
      settings.account = e.target.value;
      save();
      renderSignal();
      if (state.tab === 'risk') renderRisk();
    };
    $('#sound').onchange = (e) => {
      settings.sound = e.target.checked;
      save();
    };
    $('#lower').onchange = (e) => {
      settings.lower = chart.lower = e.target.value;
      save();
      chart.draw();
    };
    $$('[data-layer]').forEach((b) => {
      const k = b.dataset.layer;
      b.setAttribute('aria-pressed', chart.show[k] ? 'true' : 'false');
      b.onclick = () => {
        chart.show[k] = !chart.show[k];
        settings.layers[k] = chart.show[k];
        save();
        b.setAttribute('aria-pressed', chart.show[k] ? 'true' : 'false');
        chart.draw();
      };
    });
    $('#zoom-in').onclick = () => chart.zoom(1 / 1.25);
    $('#zoom-out').onclick = () => chart.zoom(1.25);
    $('#zoom-reset').onclick = () => chart.reset();
    $$('.tabs [role=tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
    $('#bell').onclick = enableAlerts;
    $('#alert-test').onclick = () => {
      toast('Aviso de prueba', ' Así verás las alertas de entrada.', 1);
      beep(1);
      notify('Aviso de prueba · Radar de Divisas', 'Así recibirás las alertas de entrada.', 'test');
    };
    $('#alerts-clear').onclick = () => {
      state.alerts = [];
      store.set('fx.alerts', []);
      renderAlerts();
    };
    $('#bt-run').onclick = runBacktest;
    ['#rk-capital', '#rk-risk', '#rk-entry', '#rk-stop', '#rk-target', '#rk-lev'].forEach((id) => $(id).addEventListener('input', renderRisk));
    $('#rk-fill').onclick = fillRiskFromSignal;
    $('#scan-on').onchange = (e) => {
      settings.scanOn = e.target.checked;
      save();
      if (settings.scanOn) scanAll();
      else scheduleScan();
    };
    $('#scan-interval').onchange = (e) => {
      settings.scanInterval = e.target.value;
      state.scan = {};
      save();
      renderScanner();
      scanAll();
    };
    $('#scan-now').onclick = scanAll;
    $('#toolbar').addEventListener('submit', (e) => e.preventDefault());
    $('#watch-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const s = normalizeSymbol($('#watch-add').value);
      if (s && !settings.watch.includes(s) && settings.watch.length < 25) {
        settings.watch.push(s);
        save();
        $('#watch-add').value = '';
        renderScanner();
        scanAll();
      }
    });
    $('#scan-table').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        settings.watch = settings.watch.filter((s) => s !== del.dataset.del);
        delete state.scan[del.dataset.del];
        save();
        renderScanner();
        return;
      }
      const row = e.target.closest('tr[data-sym]');
      if (row) {
        settings.symbol = row.dataset.sym;
        $('#symbol').value = settings.symbol;
        if (settings.interval !== settings.scanInterval && $('#interval').querySelector(`option[value="${settings.scanInterval}"]`)) {
          settings.interval = settings.scanInterval;
          $('#interval').value = settings.interval;
        }
        save();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (state.demo) startDemo();
        else load();
      }
    });
    if (!store.get('fx.noticeOk', false)) $('#notice').hidden = false;
    $('#notice-ok').onclick = () => {
      $('#notice').hidden = true;
      store.set('fx.noticeOk', true);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !state.demo && state.candles.length && Date.now() - state.lastTick > 60000) resync();
    });
  }

  // Cuentas atrás cada segundo.
  setInterval(() => {
    const t = countdown();
    $$('.countdown').forEach((el) => (el.textContent = t));
  }, 1000);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});

  bindControls();
  syncIntervals(feedFor(settings.symbol));
  renderBell();
  renderBadge();
  showTab(state.tab && $('#tab-' + state.tab) ? state.tab : 'projection');
  renderScanner();
  load();
  loadSymbols();
  setTimeout(() => (settings.scanOn ? scanAll() : scheduleScan()), 2500);
  loadForexData();
  setInterval(() => loadForexData(), 30 * 60e3);
  loadNews();
  setInterval(() => loadNews(true), 30 * 60e3);
  // Mercados: índice y análisis de pares al arrancar y cada 30 minutos.
  setTimeout(() => loadUniverse(), 4000);
  setInterval(() => loadUniverse(true), 30 * 60e3);
  if (window.radarDesktop && window.radarDesktop.onTab) window.radarDesktop.onTab((name) => $('#tab-' + name) && showTab(name));
  setInterval(() => state.tab === 'forex' && renderSessions(), 30e3);

  // Acceso para las pruebas de extremo a extremo.
  window.__radar = { state, settings, chart, recompute, startDemo, loadUniverse, analyzePairs };
})();
