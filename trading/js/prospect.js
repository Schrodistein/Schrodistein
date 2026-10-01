/* Prospecto de un par: informe que reúne el análisis de velas, el técnico
 * por escuelas, la proyección probabilística, la fuerza de cada divisa, el
 * calendario económico y los titulares, y propone planes de operación
 * condicionados (entrada, stop, objetivo, probabilidad). Lógica pura. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});
  const ok = Number.isFinite;

  /* ---------- Noticias: titulares relacionados con cada divisa ---------- */
  const KEYWORDS = {
    USD: ['dollar', 'usd', 'greenback', 'fed ', 'federal reserve', 'fomc', 'powell', 'treasury', 'payrolls', 'nonfarm', 'non-farm', 'u.s.', 'us cpi', 'pce', 'dólar', 'reserva federal'],
    EUR: ['euro', 'eur/', '/eur', 'ecb', 'lagarde', 'eurozone', 'euro area', 'bce', 'zona euro'],
    GBP: ['pound', 'sterling', 'gbp', 'bank of england', 'boe', 'bailey', 'uk ', 'libra'],
    JPY: ['yen', 'jpy', 'bank of japan', 'boj', 'ueda', 'japan', 'tankan'],
    CHF: ['swiss franc', 'chf', 'snb', 'swiss national bank'],
    CAD: ['canadian dollar', 'loonie', 'cad', 'bank of canada', 'boc'],
    AUD: ['aussie', 'australian dollar', 'aud', 'rba', 'reserve bank of australia'],
    NZD: ['kiwi', 'new zealand', 'nzd', 'rbnz'],
    CNY: ['yuan', 'renminbi', 'pboc', 'china'],
    MXN: ['peso', 'mxn', 'banxico', 'mexico'],
    TRY: ['lira', 'turkey', 'try'],
    XAU: ['gold', 'xau', 'oro'],
    XAG: ['silver', 'xag', 'plata'],
  };
  function tagNews(items) {
    return items.map((it) => {
      const t = ' ' + it.title.toLowerCase() + ' ';
      const tags = new Set(it.ccy || []);
      for (const c in KEYWORDS) if (KEYWORDS[c].some((k) => t.includes(k))) tags.add(c);
      return Object.assign({}, it, { tags: Array.from(tags) });
    });
  }

  /* ---------- Análisis de velas ---------- */
  function candleStory(S, i, atr, n) {
    n = n || 5;
    const rows = [];
    const pats = {};
    for (let k = Math.max(1, i - n + 1); k <= i; k++) {
      const o = S.o[k];
      const h = S.h[k];
      const l = S.l[k];
      const c = S.c[k];
      const range = h - l;
      const body = Math.abs(c - o);
      const up = h - Math.max(o, c);
      const lo = Math.min(o, c) - l;
      const type = range > 0 && body <= 0.1 * range ? 'indecisión' : c > o ? 'alcista' : c < o ? 'bajista' : 'indecisión';
      const notes = [];
      if (atr > 0) {
        if (body >= 1.2 * atr) notes.push('cuerpo amplio');
        else if (body <= 0.3 * atr && type !== 'indecisión') notes.push('cuerpo pequeño');
      }
      if (range > 0 && up >= 0.5 * range) notes.push('rechazo arriba (mecha superior larga)');
      if (range > 0 && lo >= 0.5 * range) notes.push('rechazo abajo (mecha inferior larga)');
      if (range > 0 && type !== 'indecisión') {
        const pos = (c - l) / range;
        if (pos >= 0.85) notes.push('cierra en máximos');
        else if (pos <= 0.15) notes.push('cierra en mínimos');
      }
      const found = FX.patterns.candles(S, k, atr).filter((p) => p.key !== 'doji' || type === 'indecisión');
      found.forEach((p) => (pats[p.name] = p));
      rows.push({ t: S.t[k], o, h, l, c, type, bodyAtr: atr > 0 ? body / atr : NaN, rangeAtr: atr > 0 ? range / atr : NaN, notes, patterns: found.map((p) => p.name) });
    }
    const bulls = rows.filter((r) => r.type === 'alcista').length;
    const bears = rows.filter((r) => r.type === 'bajista').length;
    let streak = 0;
    for (let k = rows.length - 1; k >= 0 && rows[k].type === rows[rows.length - 1].type && rows[k].type !== 'indecisión'; k--) streak++;
    const half = Math.floor(rows.length / 2);
    const early = rows.slice(0, half).reduce((s, r) => s + (r.rangeAtr || 0), 0) / Math.max(1, half);
    const late = rows.slice(half).reduce((s, r) => s + (r.rangeAtr || 0), 0) / Math.max(1, rows.length - half);
    const last = rows[rows.length - 1];
    const parts = [`Últimas ${rows.length} velas: ${bulls} alcistas, ${bears} bajistas${rows.length - bulls - bears ? ' y ' + (rows.length - bulls - bears) + ' de indecisión' : ''}.`];
    if (streak >= 3) parts.push(`${streak} velas ${last.type}s seguidas: impulso ${last.type === 'alcista' ? 'comprador' : 'vendedor'} sostenido${last.rangeAtr > 1.3 ? ', aunque extendido' : ''}.`);
    if (last) parts.push(`La última vela es ${last.type}${last.notes.length ? ' (' + last.notes.join(', ') + ')' : ''}${last.patterns.length ? ' y forma ' + last.patterns.join(' y ') : ''}.`);
    if (late > 0 && early > 0) {
      if (late < 0.7 * early) parts.push('Los rangos se están estrechando: el mercado pierde impulso y suele preparar un movimiento nuevo.');
      else if (late > 1.4 * early) parts.push('Los rangos se están ampliando: aumenta la volatilidad.');
    }
    return { rows, patterns: Object.values(pats), summary: parts.join(' '), bulls, bears, streak, lastType: last ? last.type : '' };
  }

  /* ---------- Probabilidades a partir del cono ---------- */
  // Probabilidad de que el precio termine por encima de L al final del horizonte (interpolando los cuantiles).
  function probAbove(row, L) {
    const pts = [[row.q5, 0.05], [row.q25, 0.25], [row.q50, 0.5], [row.q75, 0.75], [row.q95, 0.95]];
    if (!(L > pts[0][0])) return 0.97;
    if (!(L < pts[4][0])) return 0.03;
    for (let k = 1; k < pts.length; k++) {
      if (L <= pts[k][0]) {
        const [x0, p0] = pts[k - 1];
        const [x1, p1] = pts[k];
        return 1 - (p0 + ((L - x0) / (x1 - x0)) * (p1 - p0));
      }
    }
    return 0.03;
  }

  /* ---------- Prospecto ---------- */
  /* inp: { sym, ctx, cur, proj, events, news, strength: { CODE: { pct, rank, of } },
   *        sentiment, rr, atrStop, fmt (precio → texto), when (ms → texto), stepLabel } */
  function build(inp) {
    const { ctx, cur, proj } = inp;
    const fmt = inp.fmt || ((x) => String(x));
    const when = inp.when || ((t) => new Date(t).toISOString());
    const S = ctx.S;
    const i = cur.i;
    const atr = cur.atr;
    const price = cur.price;
    const rr = inp.rr || 2;
    const curs = FX.forex.currenciesOf(inp.sym);
    const isFx = FX.forex.isForex(inp.sym);
    const [base, quote] = isFx ? inp.sym.split('/') : [curs.find((c) => c !== 'USD') || inp.sym, 'USD'];
    const sections = [];
    const factors = [];

    // 1) Velas
    const story = candleStory(S, i, atr, 5);
    sections.push({ id: 'velas', title: 'Análisis de velas', text: story.summary, rows: story.rows });

    // 2) Técnico
    const groups = FX.signals.GROUPS;
    const gsum = (sd, g) => Math.min(groups[g].cap, sd.reasons.filter((r) => r.group === g && r.w > 0).reduce((s, r) => s + r.w, 0));
    const gtable = Object.keys(groups).map((g) => ({ group: groups[g].label, long: gsum(cur.long, g), short: gsum(cur.short, g) }));
    const techLean = Math.tanh((cur.bias || 0) / 3);
    factors.push({ name: 'Técnico (confluencia de escuelas)', value: techLean, w: 1 });
    const tParts = [];
    tParts.push(`Tendencia principal ${cur.trend > 0 ? 'alcista' : cur.trend < 0 ? 'bajista' : 'lateral'}${cur.htf ? `; temporalidad superior (${ctx.htf}) ${cur.htf > 0 ? 'alcista' : 'bajista'}` : ''}.`);
    if (cur.structure) tParts.push(`Estructura: ${cur.structure.label.toLowerCase()}.`);
    tParts.push(`Puntuación: compra ${cur.long.score.toFixed(1)} / venta ${cur.short.score.toFixed(1)} (umbral ${cur.threshold}).`);
    if (cur.figure) tParts.push(`Figura en curso: ${cur.figure.name.toLowerCase()}.`);
    if (ok(cur.snap.rsi)) tParts.push(`RSI ${cur.snap.rsi.toFixed(0)}${cur.snap.rsi > 70 ? ' (sobrecompra)' : cur.snap.rsi < 30 ? ' (sobreventa)' : ''}, ADX ${ok(cur.snap.adx) ? cur.snap.adx.toFixed(0) : '—'}.`);
    sections.push({ id: 'tecnico', title: 'Análisis técnico', text: tParts.join(' '), groups: gtable });
    if (cur.htf) factors.push({ name: `Temporalidad superior (${ctx.htf})`, value: cur.htf * 0.6, w: 0.5 });

    // 3) Proyección
    let probs = null;
    if (proj) {
      const end = proj.cone[proj.cone.length - 1];
      const pUp = FX.prospect.probAbove(end, price);
      const p = [];
      p.push(`En ${proj.horizon} ${inp.stepLabel || 'velas'} el precio debería moverse entre ${fmt(end.q25)} y ${fmt(end.q75)} (50 %) y entre ${fmt(end.q5)} y ${fmt(end.q95)} (90 %).`);
      p.push(`Volatilidad ${(proj.volAnnual * 100).toFixed(1)} % anual (percentil ${(proj.volPercentile * 100).toFixed(0)} de su historia); régimen ${proj.regime}.`);
      if (proj.base && proj.base.cond && proj.base.cond.n >= 10) {
        const c = proj.base.cond;
        const a = proj.base.all;
        const edge = c.pUp - a.pUp;
        const sig = c.ci[0] > a.ci[1] || c.ci[1] < a.ci[0];
        p.push(`Históricamente, con este mismo sesgo el precio subió en ${(c.pUp * 100).toFixed(0)} % de los casos (n = ${c.n}) frente al ${(a.pUp * 100).toFixed(0)} % general${sig ? '' : ': diferencia no significativa'}.`);
        if (sig) factors.push({ name: 'Tasa base empírica', value: Math.max(-1, Math.min(1, edge * 5)), w: 0.75 });
      }
      probs = { end, pUp };
      sections.push({ id: 'proyeccion', title: 'Proyección', text: p.join(' ') });
    }

    // 4) Fundamentales y noticias
    const f = [];
    const st = inp.strength || {};
    const sb = st[base];
    const sq = st[quote];
    if (sb && sq && ok(sb.pct) && ok(sq.pct)) {
      const diff = sb.pct - sq.pct;
      f.push(`Fuerza relativa (1 semana): ${base} ${sb.pct >= 0 ? '+' : ''}${sb.pct.toFixed(2)} % (puesto ${sb.rank} de ${sb.of}) y ${quote} ${sq.pct >= 0 ? '+' : ''}${sq.pct.toFixed(2)} % (puesto ${sq.rank} de ${sq.of}).`);
      factors.push({ name: `Fuerza ${base} frente a ${quote}`, value: Math.max(-1, Math.min(1, diff / 1.5)), w: 0.6 });
    }
    const cat = FX.universe ? FX.universe.CATALOG : {};
    const banks = curs.map((c) => cat[c] && cat[c][3] && `${c}: ${cat[c][3]}`).filter(Boolean);
    if (banks.length) f.push(`Bancos centrales: ${banks.join(' · ')}.`);
    const events = (inp.events || []).filter((e) => e.level >= 2).slice(0, 8);
    const soon = events.filter((e) => e.level >= 3 && e.t - Date.now() < 24 * 3600e3 && e.t >= Date.now());
    if (events.length) f.push(`Agenda: ${events.length} datos de impacto medio o alto para ${curs.join(' y ')} esta semana${soon.length ? `; ${soon.length} de alto impacto en menos de 24 h` : ''}.`);
    else if (inp.events) f.push('Sin datos de impacto medio o alto para estas divisas en lo que queda de semana.');
    const news = (inp.news || []).filter((n) => n.tags && n.tags.some((t) => curs.includes(t))).slice(0, 8);
    if (news.length) f.push(`${news.length} titulares recientes mencionan ${curs.join(' o ')}.`);
    if (inp.sentiment && ok(inp.sentiment.funding)) f.push(`Futuros: financiación ${(inp.sentiment.funding * 100).toFixed(4)} %${inp.sentiment.longPct ? `, ${inp.sentiment.longPct.toFixed(0)} % de cuentas en largo` : ''}.`);
    sections.push({ id: 'fundamental', title: 'Fundamentales y noticias', text: f.join(' ') || 'Sin datos fundamentales disponibles para este par.', events, news });

    // 5) Sesgo combinado
    const wsum = factors.reduce((s, x) => s + x.w, 0) || 1;
    const score = factors.reduce((s, x) => s + x.value * x.w, 0) / wsum;
    const agree = factors.filter((x) => Math.sign(x.value) === Math.sign(score) && Math.abs(x.value) > 0.15).length;
    const lean = score > 0.25 ? 1 : score < -0.25 ? -1 : 0;
    let conf = Math.abs(score) > 0.55 && agree >= 3 ? 'alta' : Math.abs(score) > 0.35 && agree >= 2 ? 'media' : 'baja';
    const risks = [];
    if (soon.length) {
      risks.push(`Dato de alto impacto en menos de 24 h: ${soon.map((e) => `${e.country} ${e.title} (${when(e.t)})`).join(' · ')}. Puede saltarse los stops.`);
      if (conf === 'alta') conf = 'media';
    }
    if (proj && proj.volPercentile > 0.9) {
      risks.push('Volatilidad en máximos de su historia reciente: amplía stops y reduce el tamaño.');
      if (conf !== 'baja') conf = 'media';
    }
    if (isFx && !FX.forex.marketOpen(new Date())) risks.push('El mercado de divisas está cerrado: puede abrir con un hueco el domingo.');
    if (cur.snap.rsi > 75 || cur.snap.rsi < 25) risks.push(`RSI extremo (${cur.snap.rsi.toFixed(0)}): entrar ahora a favor del movimiento es entrar tarde.`);
    if (cur.blocked) risks.push(cur.blocked);

    // 6) Planes de operación
    const plans = [];
    const R = inp.atrStop || 1.5;
    const res = cur.levels.resistances;
    const sup = cur.levels.supports;
    const hi = res[0] ? res[0].price : cur.structure && cur.structure.lastHigh ? cur.structure.lastHigh.price : price + 1.5 * atr;
    const lo = sup[0] ? sup[0].price : cur.structure && cur.structure.lastLow ? cur.structure.lastLow.price : price - 1.5 * atr;
    const pAbove = (L) => (probs ? FX.prospect.probAbove(probs.end, L) : NaN);
    if (cur.dir) {
      plans.push({
        kind: 'señal', dir: cur.dir, title: `Señal activa de ${cur.dir > 0 ? 'compra' : 'venta'}`, trigger: 'ya confirmada al cierre de la última vela',
        entry: cur.entry, stop: cur.stop, target: cur.target, rr: cur.rr,
        prob: proj && proj.hit ? proj.hit.target : NaN, probLabel: 'objetivo antes que stop',
      });
    }
    {
      const entry = hi + 0.1 * atr;
      const stop = Math.min(entry - R * atr, hi - 0.5 * atr);
      const next = res[1] ? res[1].price : NaN;
      const target = ok(next) && next - entry >= 1.5 * (entry - stop) ? next : entry + rr * (entry - stop);
      plans.push({ kind: 'ruptura', dir: 1, title: 'Compra por ruptura', trigger: `cierre por encima de ${fmt(hi)}`, entry, stop, target, rr: (target - entry) / (entry - stop), prob: pAbove(entry), probLabel: `de cerrar por encima de la entrada en ${proj ? proj.horizon : '—'} velas` });
    }
    {
      const entry = lo - 0.1 * atr;
      const stop = Math.max(entry + R * atr, lo + 0.5 * atr);
      const next = sup[1] ? sup[1].price : NaN;
      const target = ok(next) && entry - next >= 1.5 * (stop - entry) ? next : entry - rr * (stop - entry);
      plans.push({ kind: 'ruptura', dir: -1, title: 'Venta por ruptura', trigger: `cierre por debajo de ${fmt(lo)}`, entry, stop, target, rr: (entry - target) / (stop - entry), prob: proj ? 1 - pAbove(entry) : NaN, probLabel: `de cerrar por debajo de la entrada en ${proj ? proj.horizon : '—'} velas` });
    }
    if (proj && proj.regime === 'antipersistente' && sup[0] && res[0]) {
      plans.push({ kind: 'rango', dir: 1, title: 'Compra en soporte (rango)', trigger: `rebote con vela alcista en ${fmt(lo)}`, entry: lo + 0.2 * atr, stop: lo - R * atr * 0.7, target: (lo + hi) / 2, rr: ((lo + hi) / 2 - (lo + 0.2 * atr)) / (0.2 * atr + R * atr * 0.7), prob: NaN, probLabel: '' });
    }
    // Plan preferente: el que va a favor del sesgo.
    plans.forEach((p) => (p.preferred = lean !== 0 && p.dir === lean && (p.kind === 'señal' || !plans.some((q) => q.kind === 'señal' && q.dir === lean))));

    // 7) Conclusión
    const word = lean > 0 ? 'alcista' : lean < 0 ? 'bajista' : 'neutral';
    let action;
    if (cur.dir && cur.dir === lean) action = `La señal de ${cur.dir > 0 ? 'compra' : 'venta'} está alineada con el resto de factores.`;
    else if (cur.dir) action = `Hay señal de ${cur.dir > 0 ? 'compra' : 'venta'}, pero el resto de factores no la acompañan: si operas, hazlo con menos tamaño.`;
    else if (lean > 0) action = `Preferencia por comprar: espera ${res[0] ? 'la ruptura de ' + fmt(hi) : 'un retroceso'} o una señal de compra; evita vender contra el sesgo.`;
    else if (lean < 0) action = `Preferencia por vender: espera ${sup[0] ? 'la pérdida de ' + fmt(lo) : 'un rebote'} o una señal de venta; evita comprar contra el sesgo.`;
    else action = `Sin ventaja clara: lo prudente es esperar a que el precio salga del rango ${fmt(lo)}–${fmt(hi)}.`;
    if (soon.length) action += ' No abras posiciones justo antes del dato de alto impacto.';
    const headline = `Sesgo ${word} (confianza ${conf}). ${action}`;

    const text = [
      `PROSPECTO ${inp.sym} · ${when(S.t[i])}`,
      headline,
      ...sections.map((s) => `\n${s.title.toUpperCase()}\n${s.text}`),
      '\nPLANES',
      ...plans.map((p) => `- ${p.title}${p.preferred ? ' (preferente)' : ''}: ${p.trigger}. Entrada ${fmt(p.entry)} · stop ${fmt(p.stop)} · objetivo ${fmt(p.target)} · R:R ${ok(p.rr) ? p.rr.toFixed(1) : '—'}${ok(p.prob) ? ` · ${(p.prob * 100).toFixed(0)} % ${p.probLabel}` : ''}`),
      risks.length ? '\nRIESGOS\n' + risks.map((r) => '- ' + r).join('\n') : '',
      '\nAnálisis probabilístico generado automáticamente; no es asesoramiento financiero.',
    ].join('\n');
    return { sym: inp.sym, t: S.t[i], price, lean, word, conf, score, factors, headline, action, sections, plans, risks, story, text };
  }

  FX.prospect = { KEYWORDS, tagNews, candleStory, probAbove, build };
})(typeof globalThis !== 'undefined' ? globalThis : this);
