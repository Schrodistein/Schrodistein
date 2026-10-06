/* Terminal: vista de bróker con el comportamiento de cada activo, dividida en renta variable,
 * renta fija y divisas, cada segmento con sus activos y su índice de referencia.
 *   Lista de seguimiento con minigráficas · ficha de la acción (último, variación,
 *   máximo y mínimo de 52 semanas, volatilidad, β y correlación con el índice) ·
 *   precio · rendimientos diarios con bandas de ±2σ · distribución frente a la normal ·
 *   rendimiento acumulado frente al índice · correlación móvil · desempeño por periodo ·
 *   mapa de correlaciones de los rendimientos diarios. También arma la cinta de cotizaciones.
 * Usa los historiales cargados tal como vienen (diarios si se subieron los CSV de la BVC). */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = (d) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fin = Number.isFinite;
  const price = (x) => (!fin(x) ? '—' : Math.abs(x) >= 1000 ? nf(0).format(x) : nf(2).format(x));
  // Sin aproximar a cero: un valor distinto de cero que con d decimales se vería como 0 va en notación científica
  const small = (v, d) => v !== 0 && +Math.abs(v).toFixed(d) === 0 && PF.data && PF.data.sci;
  const pct = (x, d = 2) => (fin(x) ? (x === 0 ? '0 %' : small(x * 100, d) ? `${x > 0 ? '+' : ''}${PF.data.sci(x * 100, d)} %` : `${x > 0 ? '+' : x < 0 ? '−' : ''}${nf(d).format(Math.abs(x) * 100)} %`) : '—');
  const pctPlain = (x, d = 1) => (fin(x) ? (x === 0 ? '0 %' : small(x * 100, d) ? `${PF.data.sci(x * 100, d)} %` : `${nf(d).format(x * 100)} %`) : '—');
  // Bonos de deuda pública (TES): se cotizan por tasa. y = tasa en decimal; cambio en puntos básicos
  const rateTxt = (y) => (fin(y) ? `${nf(2).format(y * 100)} %` : '—');
  const bpTxt = (d) => (fin(d) ? `${d > 0 ? '+' : d < 0 ? '−' : ''}${nf(0).format(Math.abs(d) * 1e4)} pb` : '—');
  const isBond = (x) => !!(x && x.rates);
  const rateSeries = (x) => ({ name: x.name, dates: x.dates, prices: x.rates.map((y) => y * 100), invert: true });
  const tip = (html) => ` data-tip="${esc(html)}"`;
  const dayMs = 864e5;
  const t = (d) => Date.parse((d.length === 7 ? d + '-01' : d) + 'T00:00:00Z');
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const dayTxt = (d) => (d.length === 7 ? `${MONTHS.at(+d.slice(5, 7) - 1)} ${d.slice(0, 4)}` : `${+d.slice(8, 10)} ${MONTHS.at(+d.slice(5, 7) - 1)} ${d.slice(0, 4)}`);

  const state = { sel: null, range: '1A', seg: 'variable' };
  /* Qué índice falta en cada segmento y dónde descargarlo. */
  const NEED = {
    variable: 'el índice MSCI COLCAP (bvc.com.co → Índices → MSCI COLCAP → Históricos)',
    fija: 'el índice COLTES (CP, LP o UVR) o el COLIBR (bvc.com.co → Índices de renta fija), y las tasas cero cupón de los TES del Banco de la República (Datos → Renta fija)',
    divisas: 'el dólar USD/COP o la TRM (la app de escritorio la descarga sola)',
  };
  const RANGES = [['1M', 31], ['3M', 92], ['6M', 183], ['1A', 366], ['Todo', Infinity]];

  /* ---------- Cálculos ---------- */
  function returnsOf(s) {
    const out = [];
    for (let i = 1; i < s.dates.length; i++) if (s.prices[i] > 0 && s.prices[i - 1] > 0) out.push({ d: s.dates[i], r: Math.log(s.prices[i] / s.prices[i - 1]) });
    return out;
  }
  const mean = (a) => a.reduce((q, x) => q + x, 0) / a.length;
  const sd = (a) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((q, x) => q + (x - m) ** 2, 0) / (a.length - 1));
  };
  function aligned(a, b) {
    const mb = new Map(b.map((x) => [x.d, x.r]));
    const x = [];
    const y = [];
    const d = [];
    for (const p of a) if (mb.has(p.d)) {
      x.push(p.r);
      y.push(mb.get(p.d));
      d.push(p.d);
    }
    return { x, y, d };
  }
  function corr(x, y) {
    if (x.length < 3) return NaN;
    const mx = mean(x);
    const my = mean(y);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < x.length; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sxx += (x[i] - mx) ** 2;
      syy += (y[i] - my) ** 2;
    }
    return sxy / Math.sqrt(sxx * syy);
  }
  function priceAgo(s, days) {
    const lastT = t(s.dates.at(-1));
    for (let i = s.dates.length - 1; i >= 0; i--) if (lastT - t(s.dates[i]) >= days * dayMs - dayMs / 2) return s.prices[i];
    return NaN;
  }
  function stats(s, mkt, f) {
    const n = s.dates.length;
    const last = s.prices[n - 1];
    const prev = n > 1 ? s.prices[n - 2] : NaN;
    const lastT = t(s.dates[n - 1]);
    const year = s.dates.map((d, i) => [t(d), s.prices[i]]).filter(([x]) => lastT - x <= 365 * dayMs).map(([, p]) => p);
    const r = returnsOf(s);
    const out = { last, prev, change: Math.log(last / prev), abs: last - prev, hi: Math.max(...year), lo: Math.min(...year), y1: Math.log(last / priceAgo(s, 365)), vol: r.length > 2 ? sd(r.map((x) => x.r)) * Math.sqrt(f) : NaN, n: r.length, date: s.dates[n - 1] };
    if (mkt && mkt !== s) {
      const a = aligned(r, returnsOf(mkt));
      out.corr = corr(a.x, a.y);
      const vy = a.y.length > 2 ? sd(a.y) ** 2 : NaN;
      out.beta = fin(vy) ? (out.corr * sd(a.x) * sd(a.y)) / vy : NaN;
    } else if (mkt === s) {
      out.corr = 1;
      out.beta = 1;
    } else {
      out.corr = NaN;
      out.beta = NaN;
    }
    return out;
  }
  function inRange(dates, key) {
    const days = RANGES.find((r) => r[0] === key)[1];
    if (!fin(days)) return 0;
    const lastT = t(dates.at(-1));
    const i = dates.findIndex((d) => lastT - t(d) <= days * dayMs);
    return Math.max(0, i);
  }

  /* ---------- Ejes ---------- */
  function niceTicks(min, max, count) {
    const span = max - min || Math.abs(max) || 1;
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }
  function timeTicks(dates, X, width) {
    const n = Math.max(2, Math.floor(width / 110));
    const step = Math.max(1, Math.round(dates.length / n));
    const out = [];
    for (let i = 0; i < dates.length; i += step) out.push(`<text x="${X(i)}" y="__Y__" text-anchor="middle" class="tk">${esc(dayTxt(dates[i]))}</text>`);
    return out;
  }
  function frame(W, H, pad, ys, Y, fmt, dates, X) {
    let s = '';
    for (const v of ys) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${W - pad.r + 6}" y="${Y(v) + 4}" class="tk">${esc(fmt(v))}</text>`;
    if (dates) s += timeTicks(dates, X, W - pad.l - pad.r).join('').replace(/__Y__/g, String(H - 8));
    return s;
  }

  /* ---------- Gráficos ---------- */
  function priceChart(s, i0, W) {
    const H = 280;
    const pad = { l: 12, r: 64, t: 12, b: 26 };
    const d = s.dates.slice(i0);
    const p = s.prices.slice(i0);
    const lo = Math.min(...p);
    const hi = Math.max(...p);
    const span = hi - lo || hi * 0.05 || 1;
    const ys = niceTicks(lo - span * 0.05, hi + span * 0.05, 5);
    const y0 = Math.min(ys[0], lo);
    const y1 = Math.max(ys.at(-1), hi);
    const X = (i) => pad.l + (d.length < 2 ? 0 : (i / (d.length - 1)) * (W - pad.l - pad.r));
    const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
    const up = p.at(-1) >= p[0];
    const line = p.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const area = `${line}L${X(p.length - 1).toFixed(1)},${H - pad.b}L${X(0).toFixed(1)},${H - pad.b}Z`;
    const bw = (W - pad.l - pad.r) / Math.max(1, d.length);
    let hits = '';
    d.forEach((x, i) => (hits += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(2)}" height="${H - pad.t - pad.b}" class="hit"${tip(`<b>${esc(s.name)}</b> · ${esc(dayTxt(x))}<br><span class="num">${price(p[i])}</span>${i ? ` · ${pct(p[i] / p[i - 1] - 1)}` : ''}`)}/>`));
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Precio de ${esc(s.name)}">
      ${frame(W, H, pad, ys, Y, price, d, X)}
      <path d="${area}" class="${up ? 'ar-up' : 'ar-down'}"/>
      <path d="${line}" class="${up ? 'ln-up' : 'ln-down'}"/>
      <circle cx="${X(p.length - 1)}" cy="${Y(p.at(-1))}" r="4" class="${up ? 'dot-up' : 'dot-down'}"/>
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(p.at(-1))}" y2="${Y(p.at(-1))}" class="last-line"/>
      <rect x="${W - pad.r + 2}" y="${Y(p.at(-1)) - 9}" width="${pad.r - 4}" height="18" rx="3" class="${up ? 'tag-up' : 'tag-down'}"/>
      <text x="${W - pad.r + 6}" y="${Y(p.at(-1)) + 4}" class="tag-txt">${esc(price(p.at(-1)))}</text>
      ${hits}</svg>`;
  }

  function returnsChart(s, i0, W) {
    const H = 220;
    const pad = { l: 12, r: 64, t: 12, b: 26 };
    const r = returnsOf(s).filter((x) => x.d >= s.dates[i0]);
    if (r.length < 2) return '<p class="hint">No hay suficientes datos en este rango.</p>';
    const all = returnsOf(s).map((x) => x.r);
    const sig = sd(all);
    const m = Math.max(...r.map((x) => Math.abs(x.r)), 2.2 * sig);
    const ys = niceTicks(-m, m, 4);
    const y0 = Math.min(ys[0], -m);
    const y1 = Math.max(ys.at(-1), m);
    const X = (i) => pad.l + ((i + 0.5) / r.length) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
    const bw = Math.max(1, ((W - pad.l - pad.r) / r.length) * 0.8);
    let bars = '';
    r.forEach((x, i) => {
      const a = Y(Math.max(0, x.r));
      const b = Y(Math.min(0, x.r));
      bars += `<rect x="${(X(i) - bw / 2).toFixed(2)}" y="${a.toFixed(1)}" width="${bw.toFixed(2)}" height="${Math.max(0.8, b - a).toFixed(1)}" class="${x.r >= 0 ? 'bar-up' : 'bar-down'}"${tip(`<b>${esc(s.name)}</b> · ${esc(dayTxt(x.d))}<br>rendimiento <span class="num">${pct(x.r)}</span>`)}/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Rendimientos de ${esc(s.name)}">
      ${frame(W, H, pad, ys, Y, (v) => pct(v, 1), r.map((x) => x.d), X)}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>
      ${bars}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(2 * sig)}" y2="${Y(2 * sig)}" class="band"/>
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(-2 * sig)}" y2="${Y(-2 * sig)}" class="band"/>
      <text x="${pad.l + 4}" y="${Y(2 * sig) - 4}" class="tk">+2σ (${esc(pct(2 * sig, 1))})</text>
      <text x="${pad.l + 4}" y="${Y(-2 * sig) + 13}" class="tk">−2σ</text></svg>`;
  }

  function histChart(s, W) {
    const H = 230;
    const pad = { l: 12, r: 12, t: 12, b: 28 };
    const r = returnsOf(s).map((x) => x.r);
    if (r.length < 10) return '<p class="hint">Se necesitan al menos 10 rendimientos.</p>';
    const m = mean(r);
    const sg = sd(r);
    const lo = Math.min(...r, m - 4 * sg);
    const hi = Math.max(...r, m + 4 * sg);
    const k = Math.min(40, Math.max(12, Math.round(Math.sqrt(r.length) * 1.5)));
    const w = (hi - lo) / k;
    const counts = new Array(k).fill(0);
    r.forEach((x) => counts[Math.min(k - 1, Math.floor((x - lo) / w))]++);
    const dens = counts.map((c) => c / (r.length * w));
    const npdf = (x) => Math.exp(-0.5 * ((x - m) / sg) ** 2) / (sg * Math.sqrt(2 * Math.PI));
    const top = Math.max(...dens, npdf(m)) * 1.08;
    const X = (v) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
    let bars = '';
    dens.forEach((dv, i) => {
      const a = lo + i * w;
      bars += `<rect x="${(X(a) + 1).toFixed(1)}" y="${Y(dv).toFixed(1)}" width="${Math.max(1, X(a + w) - X(a) - 2).toFixed(1)}" height="${(H - pad.b - Y(dv)).toFixed(1)}" class="${a + w / 2 >= 0 ? 'bar-up' : 'bar-down'}"${tip(`${esc(pct(a, 1))} a ${esc(pct(a + w, 1))}<br><span class="num">${counts[i]}</span> ${counts[i] === 1 ? 'día' : 'días'}`)}/>`;
    });
    let curve = '';
    for (let i = 0; i <= 120; i++) {
      const x = lo + ((hi - lo) * i) / 120;
      curve += `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(npdf(x)).toFixed(1)}`;
    }
    const ticks = niceTicks(lo, hi, 5).map((v) => `<text x="${X(v)}" y="${H - 8}" text-anchor="middle" class="tk">${esc(pct(v, 0))}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Distribución de rendimientos de ${esc(s.name)}">
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" class="axis"/>
      ${bars}<path d="${curve}" class="normal"/>
      <line x1="${X(m)}" x2="${X(m)}" y1="${pad.t}" y2="${H - pad.b}" class="band"/>
      <text x="${X(m) + 4}" y="${pad.t + 10}" class="tk">media ${esc(pct(m, 2))}</text>
      ${ticks}</svg>`;
  }

  function cumChart(s, mkt, i0, W) {
    const H = 230;
    const pad = { l: 12, r: 56, t: 12, b: 26 };
    const start = s.dates[i0];
    const rs = returnsOf(s).filter((x) => x.d > start);
    const rm = mkt && mkt !== s ? returnsOf(mkt).filter((x) => x.d > start) : [];
    const a = rm.length ? aligned(rs, rm) : { x: rs.map((x) => x.r), y: [], d: rs.map((x) => x.d) };
    if (a.d.length < 2) return '<p class="hint">No hay fechas en común con el índice en este rango.</p>';
    // Rendimiento acumulado logarítmico desde el inicio del rango: Σ ln(Pₜ / Pₜ₋₁) = ln(Pₜ / P₀) (0 % al inicio)
    const cum = (arr) => {
      let v = 0;
      return [0].concat(arr.map((r) => (v += r)));
    };
    const ca = cum(a.x);
    const cb = rm.length ? cum(a.y) : [];
    const dd = [start].concat(a.d);
    const all = ca.concat(cb, [0]);
    const ys = niceTicks(Math.min(...all), Math.max(...all), 5);
    const y0 = Math.min(ys[0], ...all);
    const y1 = Math.max(ys.at(-1), ...all);
    const X = (i) => pad.l + (i / (dd.length - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
    const path = (c) => c.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const bw = (W - pad.l - pad.r) / dd.length;
    let hits = '';
    dd.forEach((x, i) => (hits += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(2)}" height="${H - pad.t - pad.b}" class="hit"${tip(`${esc(dayTxt(x))}<br>${esc(s.name)} <span class="num">${pct(ca[i], 1)}</span>${cb.length ? `<br>${esc(mkt.name)} <span class="num">${pct(cb[i], 1)}</span><br>Diferencia <span class="num">${pct(ca[i] - cb[i], 1)}</span>` : ''}<br><span class="sub">desde el ${esc(dayTxt(start))}</span>`)}/>`));
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Rendimiento acumulado en porcentaje">
      ${frame(W, H, pad, ys, Y, (v) => `${nf(0).format(v * 100)} %`, dd, X)}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>
      ${cb.length ? `<path d="${path(cb)}" class="ln-mkt"/>` : ''}
      <path d="${path(ca)}" class="ln-acc"/>
      ${hits}</svg>`;
  }

  function rollChart(s, mkt, W, daily) {
    const H = 200;
    const pad = { l: 12, r: 56, t: 12, b: 26 };
    if (!mkt || mkt === s) return '<p class="hint">Elige una acción: el índice tiene correlación 1 consigo mismo.</p>';
    const a = aligned(returnsOf(s), returnsOf(mkt));
    const win = daily ? 60 : 12;
    if (a.x.length < win + 5) return `<p class="hint">Se necesitan más de ${win + 5} periodos en común con el índice.</p>`;
    const pts = [];
    for (let i = win; i <= a.x.length; i++) pts.push({ d: a.d[i - 1], c: corr(a.x.slice(i - win, i), a.y.slice(i - win, i)) });
    const X = (i) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v + 1) / 2) * (H - pad.t - pad.b);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.c).toFixed(1)}`).join('');
    const bw = (W - pad.l - pad.r) / pts.length;
    let hits = '';
    pts.forEach((p, i) => (hits += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(2)}" height="${H - pad.t - pad.b}" class="hit"${tip(`${esc(dayTxt(p.d))}<br>correlación (${win} ${daily ? 'días' : 'periodos'}) <span class="num">${nf(2).format(p.c)}</span>`)}/>`));
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Correlación móvil con ${esc(mkt.name)}">
      ${frame(W, H, pad, [-1, -0.5, 0, 0.5, 1], Y, (v) => nf(1).format(v), pts.map((p) => p.d), X)}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>
      <path d="${path}" class="ln-acc"/>${hits}</svg>`;
  }

  function spark(s, W, H) {
    const p = s.prices.slice(-60);
    if (p.length < 2) return '';
    const lo = Math.min(...p);
    const hi = Math.max(...p);
    const X = (i) => (i / (p.length - 1)) * (W - 2) + 1;
    const Y = (v) => 1 + (1 - (v - lo) / (hi - lo || 1)) * (H - 2);
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${p.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')}" class="${(p.at(-1) >= p[0]) !== !!s.invert ? 'ln-up' : 'ln-down'}" style="stroke-width:1.5"/></svg>`;
  }

  /* ---------- Render ---------- */
  function width(el) {
    return el && el.clientWidth ? el.clientWidth : 0;
  }

  /* Renta variable (acciones, ETF e índices de acciones), renta fija (TES, bonos, CDT, COLTES, COLIBR)
   * y divisas (dólar, euro, TRM): cada pestaña con sus activos y su índice de referencia. */
  function segView(ctx) {
    if (!ctx || !ctx.segs) return ctx;
    const seg = ctx.segs[state.seg] ? state.seg : 'variable';
    const list = ctx.list.filter((x) => x.seg === seg);
    const bench = ctx.segs[seg].bench;
    list.sort((a, b) => (a.name === bench ? -1 : b.name === bench ? 1 : 0));
    return Object.assign({}, ctx, { list, market: bench, seg });
  }
  function segTabs(ctx) {
    const el = document.getElementById('t-segs');
    if (!el || !ctx || !ctx.segs) return;
    el.innerHTML = Object.entries(ctx.segs)
      .map(([k, v]) => {
        const n = ctx.list.filter((x) => x.seg === k).length;
        return `<button type="button" role="tab" data-seg="${k}" aria-selected="${k === state.seg}">${v.label} <span class="sub">${n}</span></button>`;
      })
      .join('');
  }

  function render(ctx0) {
    const $ = (id) => document.getElementById(id);
    segTabs(ctx0);
    const ctx = segView(ctx0);
    if (!ctx || !ctx.list.length) {
      $('term-empty').hidden = false;
      $('term-empty').innerHTML = ctx0 && ctx0.list.length ? `<h2>${esc(ctx0.segs[state.seg].label)}: sin activos</h2><p>No hay históricos de este segmento. Descarga de la BVC sus activos y ${esc(NEED[state.seg])}.</p>` : '<h2>Sin datos</h2><p>Carga los históricos de la BVC en la sección Datos (o en Mercado, en la app de escritorio) para ver el comportamiento de cada activo.</p>';
      $('term-body').hidden = true;
      return;
    }
    $('term-empty').hidden = true;
    $('term-body').hidden = false;
    const segNote = $('t-seg-note');
    if (segNote && ctx.market && /cero cup/i.test(ctx.market)) segNote.innerHTML = `Referencia de renta fija: <b>${esc(ctx.market)}</b>, mientras cargas el índice COLTES de la BVC (bvc.com.co → Índices de renta fija).`;
    else if (segNote) segNote.innerHTML = ctx.market ? `Índice de referencia de ${esc(ctx0.segs[ctx.seg].label.toLowerCase())}: <b>${esc(ctx.market)}</b>.` : `Falta el índice de referencia de ${esc(ctx0.segs[ctx.seg].label.toLowerCase())}: descarga ${esc(NEED[ctx.seg])}.`;
    const byName = new Map(ctx.list.map((s) => [s.name, s]));
    const mkt = byName.get(ctx.market) || null;
    if (!state.sel || !byName.has(state.sel)) state.sel = (ctx.list.find((s) => s.name !== ctx.market) || ctx.list[0]).name;
    const s = byName.get(state.sel);
    const f = ctx.daily ? 242 : ctx.f;
    const st = stats(s, mkt, f);

    // Lista de seguimiento
    $('tw-table').innerHTML =
      '<thead><tr><th>Activo</th><th class="n">Último</th><th class="n">Var.</th><th>60 d</th></tr></thead><tbody>' +
      ctx.list
        .map((x) => {
          const n = x.prices.length;
          if (isBond(x)) {
            // TES: tasa y cambio en pb (si la tasa sube, el precio del bono baja: se pinta en rojo)
            const dy = n > 1 ? x.rates[n - 1] - x.rates[n - 2] : NaN;
            return `<tr class="${x.name === state.sel ? 'sel' : ''}" data-asset="${esc(x.name)}" tabindex="0" title="${esc(x.name)}: deuda pública, tasa cero cupón"><td><b>${esc(x.name.replace(/^TES cero cup[oó]n /i, 'TES '))}</b>${x.name === ctx.market ? ' <span class="src">referencia</span>' : ''}</td><td class="n">${rateTxt(x.rates[n - 1])}</td><td class="n ${dy <= 0 ? 'up' : 'down'}">${bpTxt(dy)}</td><td>${spark(rateSeries(x), 72, 22)}</td></tr>`;
          }
          const ch = n > 1 ? Math.log(x.prices[n - 1] / x.prices[n - 2]) : NaN;
          return `<tr class="${x.name === state.sel ? 'sel' : ''}" data-asset="${esc(x.name)}" tabindex="0"><td><b>${esc(x.name)}</b>${x.name === ctx.market ? ' <span class="src">índice de referencia</span>' : x.cls === 'indice' ? ' <span class="src">índice</span>' : ''}</td><td class="n">${price(x.prices[n - 1])}</td><td class="n ${ch >= 0 ? 'up' : 'down'}">${pct(ch)}</td><td>${spark(x, 72, 22)}</td></tr>`;
        })
        .join('') +
      '</tbody>';

    // Ficha
    const up = st.change >= 0;
    const bond = isBond(s);
    if (bond) {
      const y = s.rates;
      const n = y.length;
      const dy = n > 1 ? y[n - 1] - y[n - 2] : NaN;
      const lastT = t(s.dates[n - 1]);
      const yr = y.filter((_, i) => lastT - t(s.dates[i]) <= 365 * dayMs);
      let y365 = NaN;
      for (let i = n - 1; i >= 0; i--) if (lastT - t(s.dates[i]) >= 365 * dayMs - dayMs / 2) {
        y365 = y[i];
        break;
      }
      const dur = s.dur || 0;
      $('th').innerHTML = `<div class="th-name"><h2>${esc(s.name)} <span class="src">deuda pública</span></h2><span class="meta">Tasa del ${esc(dayTxt(st.date))} · curva cero cupón del Banco de la República · plazo ${dur} año${dur === 1 ? '' : 's'}</span></div>
        <div class="th-price"><span class="big">${rateTxt(y[n - 1])}</span><span class="${dy <= 0 ? 'up' : 'down'}">${dy <= 0 ? '▼' : '▲'} ${esc(bpTxt(dy))}</span></div>
        <div class="rng" role="group" aria-label="Rango">${RANGES.map(([k]) => `<button type="button" data-range="${k}" aria-pressed="${k === state.range}">${k}</button>`).join('')}</div>`;
      const tb = (k, v, sub, cls) => `<div class="tile"><span class="k">${k}</span><span class="v ${cls || ''}">${v}</span>${sub ? `<span class="s">${sub}</span>` : ''}</div>`;
      $('t-tiles').innerHTML =
        tb('Precio de un cero cupón', nf(2).format(100 / Math.pow(1 + y[n - 1], dur || 1)), `por 100 de valor nominal: 100 / (1 + y)^${dur}`) +
        tb('Tasa máxima y mínima 52 semanas', `${rateTxt(Math.max(...yr))} · ${rateTxt(Math.min(...yr))}`, '') +
        tb('Cambio de la tasa en 1 año', bpTxt(y[n - 1] - y365), 'si la tasa sube, el precio del bono baja', y[n - 1] - y365 <= 0 ? 'up' : 'down') +
        tb('Rendimiento total 1 año', pct(st.y1, 1), 'causación de la tasa + efecto precio (duración)', st.y1 >= 0 ? 'up' : 'down') +
        tb('Volatilidad anual del bono', pctPlain(st.vol), 'del índice de rendimiento total') +
        tb('Beta β · correlación', `${fin(st.beta) ? nf(2).format(st.beta) : '—'} · ${fin(st.corr) ? nf(2).format(st.corr) : '—'}`, mkt ? `frente a ${esc(mkt.name)}` : '');
    } else {
    $('th').innerHTML = `<div class="th-name"><h2>${esc(s.name)}${s.name === ctx.market ? ' <span class="src">índice de referencia</span>' : ''}</h2><span class="meta">Cierre del ${esc(dayTxt(st.date))} · ${ctx.daily ? 'datos diarios' : 'datos por periodo'}</span></div>
      <div class="th-price"><span class="big">${price(st.last)}</span><span class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${esc(price(Math.abs(st.abs)))} (${esc(pct(st.change))})</span></div>
      <div class="rng" role="group" aria-label="Rango">${RANGES.map(([k]) => `<button type="button" data-range="${k}" aria-pressed="${k === state.range}">${k}</button>`).join('')}</div>`;
    const tl = (k, v, sub, cls) => `<div class="tile"><span class="k">${k}</span><span class="v ${cls || ''}">${v}</span>${sub ? `<span class="s">${sub}</span>` : ''}</div>`;
    $('t-tiles').innerHTML =
      tl('Máximo 52 semanas', price(st.hi), `${pctPlain(st.last / st.hi - 1)} desde el máximo`) +
      tl('Mínimo 52 semanas', price(st.lo), `${pctPlain(st.last / st.lo - 1)} sobre el mínimo`) +
      tl('Rendimiento 1 año', pct(st.y1, 1), '', st.y1 >= 0 ? 'up' : 'down') +
      tl('Volatilidad anual', pctPlain(st.vol), ctx.daily ? 'desviación diaria × √242' : 'desviación × √f') +
      tl('Beta β', fin(st.beta) ? nf(2).format(st.beta) : '—', mkt ? `frente a ${esc(mkt.name)}` : '') +
      tl('Correlación con el índice', fin(st.corr) ? nf(2).format(st.corr) : '—', `${st.n} rendimientos`);
    }

    const i0 = inRange(s.dates, state.range);
    $('tc-price-t').textContent = bond ? `Tasa (%) de ${s.name}` : `Precio de ${s.name}`;
    $('tc-ret-t').textContent = `Rendimientos ${ctx.daily ? 'diarios' : 'por periodo'} de ${s.name}`;
    // Rendimiento logarítmico acumulado desde el inicio del rango elegido: ln(Pₜ / P₀)
    {
      const i0c = inRange(s.dates, state.range);
      const from = s.dates[i0c];
      const gain = (x) => {
        const k = x.dates.findIndex((d) => d >= from);
        return k >= 0 ? Math.log(x.prices.at(-1) / x.prices[k]) : NaN;
      };
      $('tc-cum-t').textContent = mkt && mkt !== s ? `Rendimiento acumulado ln(Pₜ/P₀) desde el ${dayTxt(from)}: ${s.name} ${pct(gain(s), 1)} · ${mkt.name} ${pct(gain(mkt), 1)}` : `Rendimiento acumulado ln(Pₜ/P₀) desde el ${dayTxt(from)}: ${pct(gain(s), 1)}`;
    }
    $('tc-roll-t').textContent = mkt ? `Correlación móvil con ${mkt.name}` : 'Correlación móvil';
    const W = (id) => Math.max(280, width($(id)));
    if (width($('tc-price'))) {
      $('tc-price').innerHTML = priceChart(bond ? rateSeries(s) : s, i0, W('tc-price'));
      $('tc-ret').innerHTML = returnsChart(s, i0, W('tc-ret'));
      $('tc-hist').innerHTML = histChart(s, W('tc-hist'));
      $('tc-cum').innerHTML = cumChart(s, mkt, i0, W('tc-cum'));
      $('tc-roll').innerHTML = rollChart(s, mkt, W('tc-roll'), ctx.daily);
    }
    $('tc-cum-lg').innerHTML = mkt && mkt !== s ? `<span><i class="line" style="background:var(--s1)"></i>${esc(s.name)}</span><span><i class="line" style="background:var(--asset)"></i>${esc(mkt.name)}</span>` : '';

    // Desempeño por periodo
    const per = [['1 semana', 7], ['1 mes', 31], ['3 meses', 92], ['6 meses', 183], ['1 año', 365], ['Todo', Infinity]];
    $('t-perf').innerHTML =
      `<thead><tr><th>Activo</th>${per.map(([l]) => `<th class="n">${l}</th>`).join('')}<th class="n">Volatilidad anual</th><th class="n">Datos desde</th></tr></thead><tbody>` +
      ctx.list
        .map((x) => {
          const cells = per.map(([, dys]) => {
            const v = fin(dys) ? Math.log(x.prices.at(-1) / priceAgo(x, dys)) : Math.log(x.prices.at(-1) / x.prices[0]);
            return `<td class="n cell ${fin(v) ? (v >= 0 ? 'up-bg' : 'down-bg') : ''}">${pct(v, 1)}</td>`;
          });
          const rr = returnsOf(x).map((q) => q.r);
          return `<tr><td><b>${esc(x.name)}</b>${x.name === ctx.market ? ' <span class="src">índice de referencia</span>' : x.cls === 'indice' ? ' <span class="src">índice</span>' : ''}</td>${cells.join('')}<td class="n">${rr.length > 2 ? pctPlain(sd(rr) * Math.sqrt(f)) : '—'}</td><td class="n">${esc(x.dates[0])}</td></tr>`;
        })
        .join('') +
      '</tbody>';

    // Mapa de correlaciones de los rendimientos (fechas compartidas por cada par)
    const R = ctx.list.map(returnsOf);
    const C = ctx.list.map((_, i) => ctx.list.map((__, j) => (i === j ? 1 : (() => {
      const a = aligned(R[i], R[j]);
      return corr(a.x, a.y);
    })())));
    if (width($('tc-corr')) && PF.charts) $('tc-corr').innerHTML = PF.charts.corr({ width: width($('tc-corr')), names: ctx.list.map((x) => x.name), corr: C.map((r) => r.map((v) => (fin(v) ? v : 0))) });
  }

  /* Cinta de cotizaciones: último cierre y variación de cada serie. */
  function tape(ctx) {
    const el = document.getElementById('tape');
    if (!el) return;
    if (!ctx || !ctx.list.length) {
      el.hidden = true;
      return;
    }
    const items = ctx.list
      .map((x) => {
        const n = x.prices.length;
        if (isBond(x)) {
          const dy = n > 1 ? x.rates[n - 1] - x.rates[n - 2] : NaN;
          return `<span class="tk-item"><b>${esc(x.name)}</b> ${rateTxt(x.rates[n - 1])} <span class="${dy <= 0 ? 'up' : 'down'}">${dy <= 0 ? '▼' : '▲'} ${bpTxt(dy)}</span></span>`;
        }
        const ch = n > 1 ? Math.log(x.prices[n - 1] / x.prices[n - 2]) : NaN;
        return `<span class="tk-item"><b>${esc(x.name)}</b> ${price(x.prices[n - 1])} <span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'} ${pct(ch)}</span></span>`;
      })
      .join('');
    el.hidden = false;
    el.innerHTML = `<div class="tape-in">${items}${items}</div>`;
    el.style.setProperty('--tape-dur', `${Math.max(20, ctx.list.length * 5)}s`);
  }

  function wire(onChange) {
    const $ = (id) => document.getElementById(id);
    const pick = (ev) => {
      const tr = ev.target.closest('[data-asset]');
      if (!tr) return;
      state.sel = tr.getAttribute('data-asset');
      onChange();
    };
    $('t-segs').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-seg]');
      if (!b) return;
      state.seg = b.getAttribute('data-seg');
      state.sel = null;
      onChange();
    });
    $('tw-table').addEventListener('click', pick);
    $('tw-table').addEventListener('keydown', (ev) => ev.key === 'Enter' && pick(ev));
    $('th').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-range]');
      if (!b) return;
      state.range = b.getAttribute('data-range');
      onChange();
    });
  }

  PF.terminal = { render, tape, wire, state, _returnsOf: returnsOf, _stats: stats };
})(typeof globalThis !== 'undefined' ? globalThis : this);
