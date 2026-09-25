/* Gráficos SVG: frontera eficiente, línea del mercado de valores, pesos y correlaciones.
 * Se dibujan al ancho real del contenedor para que el texto conserve su tamaño en móvil.
 * Los colores salen de clases CSS (tema claro y oscuro); los tooltips usan data-tip. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = (d) => new Intl.NumberFormat('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (x, d = 1) => (Number.isFinite(x) ? nf(d).format(x * 100) + ' %' : '—');
  const num = (x, d = 2) => (Number.isFinite(x) ? nf(d).format(x) : '—');
  const f1 = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '') + nf(2).format(Math.abs(x)) : '—');

  function ticks(min, max, count) {
    const span = max - min || 1;
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { values: out, step };
  }

  function tipAttr(html) {
    return ` data-tip="${esc(html)}"`;
  }

  // Colocación simple de etiquetas: se omite la que choca con otra ya puesta.
  function labeler() {
    const boxes = [];
    return function place(x, y, text, W, H, opts) {
      const o = opts || {};
      const w = text.length * (o.cw || 6.4) + 4;
      const h = 14;
      const cands = o.cands || [[8, 4, 'start'], [-8, 4, 'end'], [0, -10, 'middle'], [0, 18, 'middle']];
      for (const [dx, dy, anchor] of cands) {
        const x0 = anchor === 'start' ? x + dx : anchor === 'end' ? x + dx - w : x + dx - w / 2;
        const y0 = y + dy - 11;
        if (x0 < 0 || x0 + w > W || y0 < 0 || y0 + h > H) continue;
        if (boxes.some((b) => x0 < b[0] + b[2] && x0 + w > b[0] && y0 < b[1] + b[3] && y0 + h > b[1])) continue;
        boxes.push([x0, y0, w, h]);
        return { x: x + dx, y: y + dy, anchor };
      }
      return null;
    };
  }

  /* Plano riesgo-rendimiento.
   * o: { width, front:[{vol,ret}], rf, tangent:{vol,ret}|null, assets:[{name,vol,ret,tip}],
   *      ports:[{label,vol,ret,sel,tip}], user:{vol,ret,tip}|null, guides:[{vol,ret}] } */
  function riskReturn(o) {
    const W = Math.max(300, o.width);
    const H = Math.round(Math.min(460, Math.max(300, W * 0.62)));
    const pad = { l: 52, r: 16, t: 14, b: 42 };
    const all = [].concat(o.front, o.assets, o.ports || [], o.user ? [o.user] : []);
    const xMax = Math.max(...all.map((p) => p.vol)) * 1.08;
    let yMin = Math.min(0, o.rf, ...all.map((p) => p.ret));
    let yMax = Math.max(...all.map((p) => p.ret));
    const ySpan = yMax - yMin || 0.1;
    yMax += ySpan * 0.06;
    if (yMin < 0) yMin -= ySpan * 0.04;
    const xt = ticks(0, xMax, Math.max(3, Math.round(W / 110)));
    const yt = ticks(yMin, yMax, 6);
    const x0 = 0;
    const x1 = Math.max(xMax, xt.values[xt.values.length - 1]);
    const y0 = Math.min(yMin, yt.values[0]);
    const y1 = Math.max(yMax, yt.values[yt.values.length - 1]);
    const X = (v) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
    const Y = (v) => H - pad.b - ((v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.aria || 'Frontera eficiente')}">`;
    for (const v of yt.values) s += `<line class="g-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="num" x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(pct(v, 0))}</text>`;
    for (const v of xt.values) s += `<text class="num" x="${X(v)}" y="${H - pad.b + 16}" text-anchor="middle">${esc(pct(v, 0))}</text>`;
    s += `<line class="g-axis" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}"/>`;
    s += `<text class="axis-title" x="${W - pad.r}" y="${H - 6}" text-anchor="end">Riesgo: desviación estándar anual σ</text>`;
    s += `<text class="axis-title" x="${pad.l}" y="${pad.t - 2}" text-anchor="start" dy="0">E(R) anual</text>`;

    const place = labeler();
    // Línea del mercado de capitales
    if (o.tangent) {
      const slope = (o.tangent.ret - o.rf) / o.tangent.vol;
      let xe = x1;
      let ye = o.rf + slope * xe;
      if (ye > y1) {
        ye = y1;
        xe = (y1 - o.rf) / slope;
      }
      s += `<line class="g-cml" x1="${X(0)}" y1="${Y(o.rf)}" x2="${X(xe)}" y2="${Y(ye)}"/>`;
      s += `<circle class="g-rf" cx="${X(0)}" cy="${Y(o.rf)}" r="5"/>`;
      s += `<circle class="hit" cx="${X(0)}" cy="${Y(o.rf)}" r="12"${tipAttr(`<b>Tasa libre de riesgo</b><br><span class="num">${pct(o.rf, 2)}</span>`)}/>`;
    }
    // Frontera
    if (o.front.length > 1) {
      const d = o.front.map((p, i) => (i ? 'L' : 'M') + X(p.vol).toFixed(1) + ',' + Y(p.ret).toFixed(1)).join('');
      s += `<path class="g-front" d="${d}"/>`;
    }
    // Guías de la confirmación
    for (const g of o.guides || []) {
      s += `<line class="g-guide" x1="${X(o.user.vol)}" y1="${Y(o.user.ret)}" x2="${X(g.vol)}" y2="${Y(g.ret)}"/>`;
      s += `<circle class="g-port" cx="${X(g.vol)}" cy="${Y(g.ret)}" r="4"/>`;
      s += `<circle class="hit" cx="${X(g.vol)}" cy="${Y(g.ret)}" r="12"${tipAttr(g.tip)}/>`;
    }
    // Reservar primero los marcadores
    const marks = [];
    o.assets.forEach((a) => marks.push({ x: X(a.vol), y: Y(a.ret), r: 4.5 }));
    (o.ports || []).forEach((p) => marks.push({ x: X(p.vol), y: Y(p.ret), r: 6 }));
    if (o.user) marks.push({ x: X(o.user.vol), y: Y(o.user.ret), r: 7 });
    // Activos
    for (const a of o.assets) {
      const cx = X(a.vol);
      const cy = Y(a.ret);
      s += `<g><circle class="hit" cx="${cx}" cy="${cy}" r="12"${tipAttr(a.tip)}/><circle class="g-asset" cx="${cx}" cy="${cy}" r="4.5" pointer-events="none"/></g>`;
    }
    // Portafolios de referencia
    let labels = '';
    const pts = [];
    for (const p of o.ports || []) {
      const cx = X(p.vol);
      const cy = Y(p.ret);
      const r = p.sel ? 7 : 5.5;
      s += p.shape === 'diamond'
        ? `<path class="g-port${p.sel ? ' sel' : ''}" d="M${cx},${cy - r - 1.5}L${cx + r + 1.5},${cy}L${cx},${cy + r + 1.5}L${cx - r - 1.5},${cy}Z" pointer-events="none"/>`
        : `<circle class="g-port${p.sel ? ' sel' : ''}" cx="${cx}" cy="${cy}" r="${r}" pointer-events="none"/>`;
      s += `<circle class="hit" cx="${cx}" cy="${cy}" r="13"${tipAttr(p.tip)}/>`;
      pts.push({ cx, cy, label: p.label, main: true });
    }
    if (o.user) {
      const cx = X(o.user.vol);
      const cy = Y(o.user.ret);
      s += `<circle class="g-user" cx="${cx}" cy="${cy}" r="7" pointer-events="none"/><circle class="hit" cx="${cx}" cy="${cy}" r="14"${tipAttr(o.user.tip)}/>`;
      pts.unshift({ cx, cy, label: 'Tu portafolio', main: true });
    }
    // Etiquetas: primero los portafolios, luego los activos si caben
    const blocked = (x0, y0, w) => marks.some((m) => x0 < m.x + m.r && x0 + w > m.x - m.r && y0 < m.y + m.r && y0 + 14 > m.y - m.r);
    const tryLabel = (cx, cy, text, cls, cw) => {
      const cands = [[10, 4, 'start'], [-10, 4, 'end'], [0, -11, 'middle'], [0, 20, 'middle'], [10, -8, 'start'], [-10, 16, 'end']];
      for (const c of cands) {
        const pos = place(cx, cy, text, W - pad.r, H - pad.b, { cands: [c], cw });
        if (!pos) continue;
        const w = text.length * cw + 4;
        const x0 = pos.anchor === 'start' ? pos.x : pos.anchor === 'end' ? pos.x - w : pos.x - w / 2;
        if (blocked(x0 + 1, pos.y - 10, w - 2)) continue;
        labels += `<text class="${cls} lbl-halo" x="${pos.x}" y="${pos.y}" text-anchor="${pos.anchor}">${esc(text)}</text><text class="${cls}" x="${pos.x}" y="${pos.y}" text-anchor="${pos.anchor}">${esc(text)}</text>`;
        return;
      }
    };
    for (const p of pts) tryLabel(p.cx, p.cy, p.label, 'lbl', 6.6);
    if (o.labelAssets !== false) for (const a of o.assets) tryLabel(X(a.vol), Y(a.ret), a.short || a.name, '', 6.1);
    s += `<g pointer-events="none">${labels}</g></svg>`;
    return s;
  }

  /* Línea del mercado de valores: β contra E(R), con el alfa de Jensen como segmento vertical. */
  function sml(o) {
    const W = Math.max(300, o.width);
    const H = Math.round(Math.min(400, Math.max(280, W * 0.6)));
    const pad = { l: 52, r: 16, t: 16, b: 42 };
    const betas = o.assets.map((a) => a.beta).concat([0, 1]);
    const bMin = Math.min(...betas) - 0.1;
    const bMax = Math.max(...betas) + 0.15;
    const line = (b) => o.rf + b * (o.Em - o.rf);
    const rets = o.assets.map((a) => a.ret).concat([o.rf, o.Em, line(bMin), line(bMax)]);
    let yMin = Math.min(...rets);
    let yMax = Math.max(...rets);
    const sp = yMax - yMin || 0.1;
    yMin -= sp * 0.05;
    yMax += sp * 0.06;
    const xt = ticks(bMin, bMax, Math.max(3, Math.round(W / 100)));
    const yt = ticks(yMin, yMax, 6);
    const X = (v) => pad.l + ((v - bMin) / (bMax - bMin)) * (W - pad.l - pad.r);
    const Y = (v) => H - pad.b - ((v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Línea del mercado de valores">`;
    for (const v of yt.values) if (v >= yMin && v <= yMax) s += `<line class="g-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="num" x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(pct(v, 0))}</text>`;
    for (const v of xt.values) if (v >= bMin && v <= bMax) s += `<text class="num" x="${X(v)}" y="${H - pad.b + 16}" text-anchor="middle">${esc(num(v, 1))}</text>`;
    s += `<line class="g-axis" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}"/>`;
    s += `<text class="axis-title" x="${W - pad.r}" y="${H - 6}" text-anchor="end">Beta β (riesgo sistemático)</text>`;
    s += `<text class="axis-title" x="${pad.l}" y="${pad.t - 4}">E(R) anual</text>`;
    s += `<line class="g-sml" x1="${X(bMin)}" y1="${Y(line(bMin))}" x2="${X(bMax)}" y2="${Y(line(bMax))}"/>`;
    const place = labeler();
    let labels = '';
    for (const a of o.assets) {
      const cx = X(a.beta);
      const cy = Y(a.ret);
      const cl = Y(line(a.beta));
      if (Math.abs(cy - cl) > 1) s += `<line class="${a.ret >= line(a.beta) ? 'g-alpha-pos' : 'g-alpha-neg'}" x1="${cx}" x2="${cx}" y1="${cl}" y2="${cy}"/>`;
    }
    const mk = [{ b: 1, r: o.Em, name: o.marketName || 'Mercado', cls: 'g-port', tip: `<b>${esc(o.marketName || 'Mercado')}</b><br>β = 1 · E(R) <span class="num">${pct(o.Em)}</span>` }];
    for (const a of o.assets) {
      const cx = X(a.beta);
      const cy = Y(a.ret);
      s += `<circle class="g-asset" cx="${cx}" cy="${cy}" r="4.5"/><circle class="hit" cx="${cx}" cy="${cy}" r="12"${tipAttr(a.tip)}/>`;
    }
    for (const m of mk) {
      s += `<circle class="${m.cls}" cx="${X(m.b)}" cy="${Y(m.r)}" r="5.5"/><circle class="hit" cx="${X(m.b)}" cy="${Y(m.r)}" r="12"${tipAttr(m.tip)}/>`;
      const pos = place(X(m.b), Y(m.r), 'Mercado', W - pad.r, H - pad.b, { cands: [[0, 20, 'middle'], [10, 16, 'start']], cw: 6.6 });
      if (pos) labels += `<text class="lbl lbl-halo" x="${pos.x}" y="${pos.y}" text-anchor="${pos.anchor}">Mercado</text><text class="lbl" x="${pos.x}" y="${pos.y}" text-anchor="${pos.anchor}">Mercado</text>`;
    }
    for (const a of o.assets) {
      const pos = place(X(a.beta), Y(a.ret), a.short, W - pad.r, H - pad.b, { cw: 6.1 });
      if (pos) labels += `<text class="lbl-halo" x="${pos.x}" y="${pos.y}" text-anchor="${pos.anchor}">${esc(a.short)}</text><text x="${pos.x}" y="${pos.y}" text-anchor="${pos.anchor}">${esc(a.short)}</text>`;
    }
    s += `<g pointer-events="none">${labels}</g></svg>`;
    return s;
  }

  /* Barras horizontales: peso y contribución al riesgo de cada activo. */
  function weights(o) {
    const W = Math.max(280, o.width);
    const rows = o.rows;
    const rowH = 34;
    const labelW = Math.min(170, Math.max(90, W * 0.34));
    const valW = 58;
    const pad = { t: 6, b: 6 };
    const H = pad.t + pad.b + rows.length * rowH;
    const vmin = Math.min(0, ...rows.map((r) => Math.min(r.w, r.rc)));
    const vmax = Math.max(0.0001, ...rows.map((r) => Math.max(r.w, r.rc)));
    const x0 = labelW + 8;
    const x1 = W - valW;
    const X = (v) => x0 + ((v - vmin) / (vmax - vmin)) * (x1 - x0);
    const maxChars = Math.floor((labelW - 4) / 6.6);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Pesos del portafolio">`;
    s += `<line class="g-axis" x1="${X(0)}" x2="${X(0)}" y1="${pad.t}" y2="${H - pad.b}"/>`;
    const bar = (v, y, h, cls) => {
      const a = X(Math.min(0, v));
      const b = X(Math.max(0, v));
      const w = Math.max(0, b - a);
      if (w < 0.5) return '';
      const r = Math.min(3, w / 2, h / 2);
      // Extremo de datos redondeado, base recta
      if (v >= 0) return `<path class="${cls}" d="M${a},${y}H${b - r}Q${b},${y} ${b},${y + r}V${y + h - r}Q${b},${y + h} ${b - r},${y + h}H${a}Z"/>`;
      return `<path class="${cls}" d="M${b},${y}H${a + r}Q${a},${y} ${a},${y + r}V${y + h - r}Q${a},${y + h} ${a + r},${y + h}H${b}Z"/>`;
    };
    rows.forEach((r, i) => {
      const y = pad.t + i * rowH;
      const name = r.name.length > maxChars ? r.name.slice(0, maxChars - 1) + '…' : r.name;
      s += `<g${tipAttr(r.tip)}><rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}"/>`;
      s += `<text class="lbl" x="0" y="${y + 17}"${r.w === 0 ? ' opacity="0.55"' : ''}>${esc(name)}</text>`;
      s += bar(r.w, y + 6, 12, r.w < 0 ? 'g-bar-neg' : 'g-bar');
      s += bar(r.rc, y + 20, 6, 'g-risk');
      s += `<text class="num" x="${W}" y="${y + 17}" text-anchor="end">${esc(pct(r.w, 1))}</text></g>`;
    });
    s += '</svg>';
    return s;
  }

  /* Mapa de calor de correlaciones (escala divergente, gris en cero). */
  function corr(o) {
    const n = o.names.length;
    const W = Math.max(280, o.width);
    const labelW = Math.min(150, W * 0.32);
    const cell = Math.max(14, Math.min(40, (W - labelW - 4) / n));
    const top = 22;
    const H = top + cell * n + 4;
    const maxChars = Math.floor((labelW - 26) / 6.4);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Matriz de correlaciones">`;
    o.names.forEach((nm, j) => {
      s += `<text class="num" x="${labelW + j * cell + cell / 2}" y="${top - 8}" text-anchor="middle">${j + 1}</text>`;
    });
    o.names.forEach((nm, i) => {
      const y = top + i * cell;
      const name = nm.length > maxChars ? nm.slice(0, maxChars - 1) + '…' : nm;
      s += `<text x="${labelW - 6}" y="${y + cell / 2 + 4}" text-anchor="end"><tspan class="num">${i + 1}</tspan> ${esc(name)}</text>`;
      o.names.forEach((nm2, j) => {
        const v = o.corr[i][j];
        const pole = v >= 0 ? 'var(--div-pos)' : 'var(--div-neg)';
        const k = Math.round(Math.min(1, Math.abs(v)) * 100);
        const x = labelW + j * cell;
        s += `<rect x="${x + 1}" y="${y + 1}" width="${cell - 2}" height="${cell - 2}" rx="2" style="fill:color-mix(in oklab, ${pole} ${k}%, var(--div-mid))"${tipAttr(`<b>${esc(nm)}</b> × <b>${esc(nm2)}</b><br>correlación <span class="num">${f1(v)}</span>`)}/>`;
        if (cell >= 34 && i !== j) s += `<text class="num" x="${x + cell / 2}" y="${y + cell / 2 + 4}" text-anchor="middle" pointer-events="none" style="fill:${k > 55 ? '#fff' : 'var(--ink)'};font-size:10px">${esc(num(v, 1))}</text>`;
      });
    });
    s += '</svg>';
    return s;
  }

  PF.charts = { riskReturn, sml, weights, corr, esc, pct, num, f1, ticks };
})(typeof globalThis !== 'undefined' ? globalThis : this);
