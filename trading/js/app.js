/* Interfaz de Radar de Divisas: datos en directo, señales, avisos,
 * escáner, proyección, backtest y calculadora de riesgo. */
(function () {
  'use strict';
  const { util: U, signals: SG, backtest: BT, risk: RK, binance: API, stats: ST } = FX;

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
  const DEFAULT_WATCH = ['EURUSDT', 'PAXGUSDT', 'USDTTRY', 'USDTBRL', 'BTCUSDT', 'ETHUSDT'];
  const DEFAULT_LAYERS = { ema: true, bb: false, ich: false, levels: true, fib: false, proj: true };
  const saved = store.get('fx.settings', {});
  const settings = Object.assign(
    {
      symbol: 'EURUSDT', interval: '1h', profile: 'equilibrado', market: 'spot', trendFilter: true, mtfFilter: false,
      rr: 2, atrStop: 1.5, capital: 1000, riskPct: 1, fee: 0.1, horizon: 24, sound: true, lower: 'rsi',
      scanOn: true, scanInterval: '1h', watch: DEFAULT_WATCH.slice(), tab: 'projection',
    },
    saved
  );
  settings.layers = Object.assign({}, DEFAULT_LAYERS, saved.layers || {});
  const save = () => store.set('fx.settings', settings);
  const futures = () => settings.market === 'futures';
  const sigOpts = (dec) => ({
    profile: settings.profile, trendFilter: settings.trendFilter, mtfFilter: settings.mtfFilter,
    rr: settings.rr, atrStop: settings.atrStop, allowShort: futures(), decimals: dec == null ? state.dec : dec,
  });

  const state = {
    candles: [], ctx: null, evals: [], evalFrom: 0, cur: null, markers: [], proj: null, info: null, dec: 4,
    stream: null, pollTimer: null, demoTimer: null, demo: false, token: 0, lastTick: 0, ticker: null, sentiment: null,
    alerts: store.get('fx.alerts', []), alertKeys: new Set(store.get('fx.alertKeys', [])), unseen: 0,
    scan: {}, scanning: false, scanTimer: null, scanNext: 0, tab: settings.tab, lightTimer: null,
  };

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

  function normalizeSymbol(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  async function load() {
    const token = ++state.token;
    stopLive();
    state.demo = false;
    state.ticker = null;
    state.sentiment = null;
    $('#load-error').hidden = true;
    setConn('connecting', 'Cargando…');
    $('#q-sym').textContent = settings.symbol;
    chart.set({ message: 'Cargando ' + settings.symbol + '…' });
    try {
      const [info, kl] = await Promise.all([
        API.symbolInfo(settings.symbol).catch((e) => {
          if (e.code === -1121) throw e;
          return null;
        }),
        API.klines(settings.symbol, settings.interval, 1000),
      ]);
      if (token !== state.token) return;
      if (!kl.length) throw new Error('Binance no devolvió velas para este par.');
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
    const fx = /^(EUR|GBP|AUD|USDT?TRY|USDTBRL)/.test(sym);
    const C = U.synthetic(n, { seed: hashSeed(sym + interval), intervalMs: step, end: now, start: fx ? 1.08 : 100, vol: 0.004 * Math.sqrt(step / 3600e3) });
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
    state.stream = API.stream(settings.symbol, settings.interval, onKline, (s) => {
      if (token !== state.token) return;
      if (s === 'live') {
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
    // Red de seguridad: si el flujo calla, se piden las velas por REST.
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
      const kl = await API.klines(settings.symbol, settings.interval, 1000);
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
    if (state.demo) return;
    try {
      const t = await API.ticker24(settings.symbol);
      if (token === state.token) {
        state.ticker = t;
        renderQuote();
      }
    } catch (e) {
      /* el precio sigue llegando por el flujo */
    }
  }

  async function refreshSentiment(token) {
    if (state.demo) return;
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
    if (t) meta.push('Máx 24 h ' + fp(t.high), 'Mín 24 h ' + fp(t.low), 'Vol ' + compact(t.quoteVolume) + (info ? ' ' + info.quote : ''));
    meta.push(IV[settings.interval] + ' · cierre en <span class="countdown">' + countdown() + '</span>');
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

  function sizing(entry, stop, target) {
    return RK.positionSize({
      capital: settings.capital, riskPct: settings.riskPct, entry, stop, target, feePct: settings.fee,
      maxLeverage: futures() ? 3 : 1, stepSize: state.info ? state.info.stepSize : 0, minNotional: state.info ? state.info.minNotional : 0,
    });
  }

  function feeWarning(riskPct) {
    const rt = 2 * settings.fee;
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
    if (cur.dir < 0 && !futures()) word = 'VENDER / CERRAR';
    let html = `<div class="verdict ${cls}"><div class="k">Señal · vela de ${IV[settings.interval]} cerrada ${when(cur.t)}</div><div class="v">${word}</div>`;
    html += cur.dir ? `<div class="small">Confluencia ${cur.strength} · ${nf(cur.score)} puntos (umbral ${nf(thr, 1)})</div>` : `<div class="small">${biasText(cur.bias)}</div>`;
    html += '</div>';
    html += `<div class="meter"><span>Compra</span>${bar(cur.long.score, 'var(--up)')}<span class="num">${nf(cur.long.score)}</span><span>Venta</span>${bar(cur.short.score, 'var(--down)')}<span class="num">${nf(cur.short.score)}</span></div>`;
    if (state.demo) html += '<div class="callout info">Modo demostración: precios simulados, no reales. No operes con estas señales.</div>';
    if (cur.dir) {
      const ps = sizing(cur.entry, cur.stop, cur.target);
      const hit = state.proj && state.proj.hit;
      const base = state.info ? state.info.base : '';
      const quote = state.info ? state.info.quote : '';
      html += '<dl class="kv">';
      html += `<dt>Entrada</dt><dd>${fp(cur.entry)}</dd>`;
      html += `<dt>Stop <span class="small">(${esc(cur.stopKind)})</span></dt><dd class="down">${fp(cur.stop)} <span class="small">${pct(((cur.stop / cur.entry) - 1) * 100)}</span></dd>`;
      html += `<dt>Objetivo (R:R ${nf(cur.rr, 1)})</dt><dd class="up">${fp(cur.target)} <span class="small">${pct(((cur.target / cur.entry) - 1) * 100)}</span></dd>`;
      if (hit) html += `<dt>Prob. objetivo antes que stop</dt><dd>${ppc(hit.target)} <span class="small">(mín. rentable ${ppc(hit.breakeven)})</span></dd>`;
      if (ps) {
        html += `<dt>Tamaño (${nf(settings.riskPct, 1)} % de ${nf(settings.capital, 0)})</dt><dd>${nf(ps.qty, state.info && state.info.qtyDecimals != null ? state.info.qtyDecimals : 6)} ${esc(base)}</dd>`;
        html += `<dt>Valor de la posición</dt><dd>${nf(ps.notional)} ${esc(quote)}${ps.leverage > 1.01 ? ' · ' + nf(ps.leverage, 1) + '×' : ''}</dd>`;
        html += `<dt>Pérdida si salta el stop</dt><dd class="down">−${nf(ps.lossAtStop)} ${esc(quote)}</dd>`;
      }
      html += '</dl>';
      if (ps && ps.capped) html += '<div class="callout">El stop está tan cerca que para arriesgar ese porcentaje harías falta más capital del que tienes: el tamaño se ha limitado' + (futures() ? ' a 3× de apalancamiento.' : ' a tu capital (spot).') + '</div>';
      if (ps && ps.belowMin) html += `<div class="callout">La posición es menor que el mínimo de Binance para este par (${nf(state.info.minNotional)} ${esc(quote)}).</div>`;
      if (!state.demo) html += `<a class="btn primary" href="${API.tradeUrl(state.info, settings.symbol, futures())}" target="_blank" rel="noopener">Abrir en Binance ↗</a>`;
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
    html += `<p class="small muted">Próximo cierre en <span class="countdown num">${countdown()}</span>. Señal probabilística, no asesoramiento financiero.</p>`;
    el.innerHTML = html;
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
    else if (t === 'scanner') renderScanner();
    else if (t === 'alerts') renderAlerts();
    else if (t === 'risk') renderRisk();
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
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) return reg.showNotification(title, opts);
    } catch (e) {
      /* sin service worker */
    }
    try {
      new Notification(title, opts);
    } catch (e) {
      /* el navegador no permite notificaciones aquí */
    }
  }

  function alertSignal(sym, iv, r, dec, src) {
    const key = [sym, iv, r.t, r.dir].join('|');
    if (state.alertKeys.has(key)) return;
    state.alertKeys.add(key);
    store.set('fx.alertKeys', Array.from(state.alertKeys).slice(-300));
    const side = r.dir > 0 ? r.long : r.short;
    const a = {
      id: key, at: Date.now(), sym, iv, dir: r.dir, t: r.t, price: r.entry, stop: r.stop, target: r.target, score: r.score,
      strength: r.strength, dec, src, spot: !futures(), demo: state.demo,
      reasons: side.reasons.filter((x) => x.trigger).sort((x, y) => y.w - x.w).slice(0, 4).map((x) => x.text),
    };
    state.alerts.unshift(a);
    state.alerts = state.alerts.slice(0, 200);
    store.set('fx.alerts', state.alerts);
    const word = r.dir > 0 ? 'COMPRA' : a.spot ? 'VENTA (cerrar compras)' : 'VENTA';
    const title = `${word} · ${sym} · ${IV[iv] || iv}${state.demo ? ' (demo)' : ''}`;
    const body = `Entrada ${U.fmtPrice(r.entry, dec)} · Stop ${U.fmtPrice(r.stop, dec)} · Objetivo ${U.fmtPrice(r.target, dec)}. ${a.reasons[0] || ''}`;
    toast(title, ' ' + body, r.dir);
    beep(r.dir);
    if (navigator.vibrate) navigator.vibrate(r.dir > 0 ? [80, 60, 80] : [200]);
    notify(title, body, key);
    if (state.tab !== 'alerts') state.unseen++;
    renderBadge();
    if (state.tab === 'alerts') renderAlerts();
  }

  function renderBadge() {
    const b = $('#alert-badge');
    b.hidden = !state.unseen;
    b.textContent = state.unseen;
  }

  function renderAlerts() {
    const perm = !('Notification' in window) ? 'Este navegador no admite notificaciones: los avisos se mostrarán dentro de la app.' : Notification.permission === 'granted' ? 'Notificaciones activadas.' : Notification.permission === 'denied' ? 'Has bloqueado las notificaciones para esta web: actívalas en los ajustes del navegador.' : 'Pulsa «Activar avisos» para recibir notificaciones del sistema.';
    $('#notif-state').textContent = perm + ' Los avisos solo llegan mientras la app esté abierta (aunque esté en segundo plano).';
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
      return `<tr class="click" data-sym="${esc(sym)}">
        <td class="num"><strong>${esc(sym)}</strong></td>
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

  async function scanAll() {
    if (state.scanning) return;
    state.scanning = true;
    const iv = settings.scanInterval;
    $('#scan-status').textContent = 'Escaneando…';
    for (const sym of settings.watch.slice()) {
      try {
        const kl = state.demo ? demoCandles(sym, iv, 400) : await API.klines(sym, iv, 400);
        const ctx = SG.analyze(kl, { interval: iv });
        const li = U.lastClosed(kl);
        const dec = U.autoDecimals(kl[li].c);
        const evs = SG.evaluateRange(ctx, sigOpts(dec), li - SG.COOLDOWN, li);
        const r = evs[evs.length - 1];
        const fresh = SG.isFresh(evs, evs.length - 1);
        const lastK = kl[kl.length - 1];
        let k0 = kl.length - 1;
        while (k0 > 0 && kl[k0].t > lastK.t - 86400e3) k0--;
        state.scan[sym] = { price: lastK.c, chg: (lastK.c / kl[k0].c - 1) * 100, r, fresh, dec };
        if (fresh) alertSignal(sym, iv, r, dec, 'escáner');
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
        C = await API.history(settings.symbol, settings.interval, bars, (got, tot) => (out.innerHTML = `<p class="muted">Descargando histórico… ${got} / ${tot} velas</p>`));
      }
      C = C.filter((k) => k.closed !== false);
      if (C.length < 300) throw new Error('Hacen falta al menos 300 velas cerradas para un backtest.');
      out.innerHTML = `<p class="muted">Analizando ${C.length} velas…</p>`;
      await sleep(30);
      const ctx = SG.analyze(C, { interval: settings.interval });
      const res = BT.run(ctx, Object.assign(sigOpts(U.autoDecimals(C[C.length - 1].c)), { capital: settings.capital, riskPct: settings.riskPct, feePct: settings.fee, maxBars, maxLeverage: futures() ? 3 : 1 }));
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
    let html = `<p class="small muted">${nBars} velas · ${when(s.from)} – ${when(s.to)} · ${settings.symbol} ${IV[settings.interval]} · perfil ${SG.PROFILES[settings.profile].label.toLowerCase()} · ${futures() ? 'largos y cortos (máx. 3×)' : 'solo largos (spot)'}${state.demo ? ' · datos simulados' : ''}</p>`;
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
    const r = RK.positionSize({ capital, riskPct, entry, stop, target: target > 0 ? target : null, feePct: settings.fee, maxLeverage: lev, stepSize: state.info ? state.info.stepSize : 0, minNotional: state.info ? state.info.minNotional : 0 });
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
    out.innerHTML = html;
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
    $('#symbols').innerHTML = list.map((s) => `<option value="${esc(s)}">`).join('');
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
    $('#watch-form').addEventListener('submit', () => {
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

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  bindControls();
  renderBell();
  renderBadge();
  showTab(state.tab && $('#tab-' + state.tab) ? state.tab : 'projection');
  renderScanner();
  load();
  loadSymbols();
  setTimeout(() => (settings.scanOn ? scanAll() : scheduleScan()), 2500);

  // Acceso para las pruebas de extremo a extremo.
  window.__radar = { state, settings, chart, recompute, startDemo };
})();
