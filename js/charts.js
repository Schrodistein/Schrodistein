/* Gráficos SVG: curva normal del CI y perfil de índices. */
(function (root) {
  'use strict';
  const IQ = (root.IQ = root.IQ || {});

  const MIN = 55;
  const MAX = 145;

  function pdf(x) {
    const z = (x - 100) / 15;
    return Math.exp(-0.5 * z * z);
  }

  /* opts: { iq, ciLow, ciHigh, width, height, showRanges } */
  function bell(opts) {
    const W = opts.width || 480;
    const H = opts.height || 190;
    const pad = { l: 12, r: 12, t: 22, b: 40 };
    const x = (v) => pad.l + ((v - MIN) / (MAX - MIN)) * (W - pad.l - pad.r);
    const y = (p) => H - pad.b - p * (H - pad.t - pad.b);
    const pts = [];
    for (let v = MIN; v <= MAX; v += 1) pts.push(`${x(v).toFixed(1)},${y(pdf(v)).toFixed(1)}`);
    const area = (lo, hi) => {
      const p = [`${x(lo).toFixed(1)},${y(0)}`];
      for (let v = lo; v <= hi; v += 0.5) p.push(`${x(v).toFixed(1)},${y(pdf(v)).toFixed(1)}`);
      p.push(`${x(hi).toFixed(1)},${y(0)}`);
      return p.join(' ');
    };
    let s = `<svg class="bell" viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva normal del CI${opts.iq ? ', tu resultado ' + opts.iq : ''}">`;
    // Bandas de rangos
    const bands = [
      [MIN, 70], [70, 80], [80, 90], [90, 110], [110, 120], [120, 130], [130, MAX],
    ];
    bands.forEach(([lo, hi], i) => {
      const op = [0.1, 0.16, 0.24, 0.34, 0.24, 0.16, 0.1][i];
      s += `<polygon points="${area(lo, hi)}" fill="var(--accent)" fill-opacity="${op}"/>`;
    });
    if (opts.ciLow != null) {
      const lo = Math.max(MIN, opts.ciLow), hi = Math.min(MAX, opts.ciHigh);
      s += `<rect x="${x(lo)}" y="${pad.t - 8}" width="${Math.max(2, x(hi) - x(lo))}" height="${y(0) - pad.t + 8}" fill="var(--band-soft)"/>`;
    }
    s += `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
    s += `<line x1="${pad.l}" y1="${y(0)}" x2="${W - pad.r}" y2="${y(0)}" stroke="var(--line)" stroke-width="1"/>`;
    for (const v of [55, 70, 85, 100, 115, 130, 145]) {
      s += `<line x1="${x(v)}" y1="${y(0)}" x2="${x(v)}" y2="${y(0) + 5}" stroke="var(--ink-3)"/>`;
      s += `<text x="${x(v)}" y="${y(0) + 18}" text-anchor="middle">${v}</text>`;
    }
    if (opts.showRanges) {
      // Percentil de cada punto de corte
      const cuts = [[70, 2], [85, 16], [100, 50], [115, 84], [130, 98]];
      cuts.forEach(([v, p]) => {
        s += `<text x="${x(v)}" y="${y(0) + 32}" text-anchor="middle" class="lbl">P${p}</text>`;
      });
    }
    if (opts.iq != null) {
      const v = Math.max(MIN, Math.min(MAX, opts.iq));
      s += `<line x1="${x(v)}" y1="${pad.t - 10}" x2="${x(v)}" y2="${y(0)}" stroke="var(--band)" stroke-width="2.5"/>`;
      s += `<circle cx="${x(v)}" cy="${y(pdf(v))}" r="5" fill="var(--band)" stroke="var(--surface)" stroke-width="2"/>`;
      const anchor = v > 132 ? 'end' : v < 68 ? 'start' : 'middle';
      s += `<text x="${x(v)}" y="${pad.t - 12}" text-anchor="${anchor}" style="font-size:13px;font-weight:600;fill:var(--ink)">${opts.label || 'Tú'} · ${opts.iq}</text>`;
    }
    return s + '</svg>';
  }

  /* rows: [{label, iq, ciLow, ciHigh}] */
  function profile(rows) {
    const W = 460;
    const rowH = 46;
    const labelW = 150;
    const pad = { t: 10, b: 30, r: 16 };
    const H = pad.t + rows.length * rowH + pad.b;
    const x = (v) => labelW + ((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * (W - labelW - pad.r);
    let s = `<svg class="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil de índices">`;
    s += `<rect x="${x(90)}" y="${pad.t}" width="${x(110) - x(90)}" height="${rows.length * rowH}" fill="var(--accent)" fill-opacity="0.08"/>`;
    for (const v of [55, 70, 85, 100, 115, 130, 145]) {
      s += `<line x1="${x(v)}" y1="${pad.t}" x2="${x(v)}" y2="${pad.t + rows.length * rowH}" stroke="var(--line)" stroke-dasharray="${v === 100 ? '0' : '3 4'}"/>`;
      s += `<text class="tick" x="${x(v)}" y="${H - 10}" text-anchor="middle">${v}</text>`;
    }
    rows.forEach((r, i) => {
      const cy = pad.t + i * rowH + rowH / 2;
      s += `<text x="0" y="${cy + 4}">${r.label}</text>`;
      s += `<line x1="${x(r.ciLow)}" y1="${cy}" x2="${x(r.ciHigh)}" y2="${cy}" stroke="var(--band)" stroke-width="6" stroke-linecap="round" stroke-opacity="0.45"/>`;
      s += `<circle cx="${x(r.iq)}" cy="${cy}" r="7" fill="${r.total ? 'var(--band)' : 'var(--accent)'}" stroke="var(--surface)" stroke-width="2"/>`;
      s += `<text class="tick" x="${x(r.iq)}" y="${cy - 12}" text-anchor="middle" style="fill:var(--ink);font-weight:600">${r.iq}</text>`;
    });
    return s + '</svg>';
  }

  IQ.charts = { bell, profile };
})(typeof globalThis !== 'undefined' ? globalThis : this);
