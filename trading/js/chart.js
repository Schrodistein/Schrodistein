/* Gráfico de velas en canvas, sin dependencias.
 * Rueda o pellizco: zoom · arrastrar: desplazar · doble clic: restablecer. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});
  const ok = Number.isFinite;

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * mag;
  }

  const TF = {
    time: new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }),
    day: new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }),
    full: new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };

  class Chart {
    constructor(canvas) {
      this.cv = canvas;
      this.g = canvas.getContext('2d');
      this.visible = 120;
      this.offset = 0;
      this.lower = 'rsi';
      this.show = { ema: true, bb: false, ich: false, levels: true, fib: false, proj: true };
      this.data = null;
      this.hover = null;
      this.pointers = new Map();
      this.layout = null;
      this._bind();
      if (root.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      this.resize();
    }

    resize() {
      const box = this.cv.parentElement.getBoundingClientRect();
      this.dpr = root.devicePixelRatio || 1;
      this.W = Math.max(240, Math.floor(box.width));
      this.H = Math.max(240, Math.floor(box.height));
      this.cv.width = Math.round(this.W * this.dpr);
      this.cv.height = Math.round(this.H * this.dpr);
      this.cv.style.width = this.W + 'px';
      this.cv.style.height = this.H + 'px';
      this._draw();
    }

    set(data) {
      this.data = data;
      this.clamp();
      this.draw();
    }

    zoom(f) {
      this.visible = Math.round(this.visible * f);
      this.clamp();
      this.draw();
    }

    reset() {
      this.visible = this.W < 600 ? 55 : 120;
      this.offset = 0;
      this.draw();
    }

    clamp() {
      const n = this.data && this.data.S ? this.data.S.n : 0;
      if (!n) return;
      this.visible = Math.max(20, Math.min(Math.max(20, n), this.visible));
      this.offset = Math.max(0, Math.min(Math.max(0, n - 20), Math.round(this.offset)));
    }

    draw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._draw();
      });
    }

    colors() {
      const cs = getComputedStyle(this.cv);
      const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
      return {
        up: v('--up', '#1f9d6b'), down: v('--down', '#d6453d'), ink: v('--ink', '#111'), ink2: v('--ink-2', '#555'), ink3: v('--ink-3', '#999'),
        grid: v('--grid', 'rgba(127,127,127,.15)'), surface: v('--surface', '#fff'), accent: v('--accent', '#f5a524'),
        ema20: v('--ema20', '#5b9cff'), ema50: v('--ema50', '#f5a524'), ema200: v('--ema200', '#b07cff'), bb: v('--bb', 'rgba(127,127,127,.6)'),
        cloudUp: v('--cloud-up', 'rgba(31,157,107,.14)'), cloudDn: v('--cloud-dn', 'rgba(214,69,61,.14)'), proj: v('--proj', '#5b9cff'), fib: v('--fib', '#c084fc'),
        mono: v('--font-mono', 'monospace'),
      };
    }

    _draw() {
      const g = this.g;
      const W = this.W;
      const H = this.H;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const C = this.colors();
      const d = this.data;
      g.font = `11px ${C.mono}`;
      if (!d || !d.S || d.S.n < 2) {
        g.fillStyle = C.ink3;
        g.textAlign = 'center';
        g.fillText(d && d.message ? d.message : 'Cargando datos…', W / 2, H / 2);
        return;
      }
      const S = d.S;
      const n = S.n;
      const dec = d.decimals == null ? FX.util.autoDecimals(S.c[n - 1]) : d.decimals;
      const fp = (x) => x.toFixed(dec);
      const axisW = Math.max(58, g.measureText(fp(S.c[n - 1])).width + 18);
      const axisH = 20;
      const plotW = W - axisW;
      const lowerOn = this.lower !== 'none';
      const mainH = lowerOn ? Math.round((H - axisH) * 0.74) : H - axisH;
      const lowTop = mainH + 6;
      const lowH = H - axisH - lowTop;
      const cone = this.show.proj && d.cone && d.cone.length && this.offset === 0 ? d.cone : null;
      const ahead = this.show.ich && d.ctx && d.ctx.ich && this.offset === 0 ? d.ctx.ich.ahead : null;
      const c0 = d.coneFrom == null ? n - 1 : Math.min(n - 1, d.coneFrom);
      const pad = Math.max(3, cone ? cone.length - (n - 1 - c0) + 2 : 0, ahead ? ahead.length + 1 : 0);
      const vis = this.visible;
      const end = n - 1 - this.offset;
      const bw = plotW / (vis + pad);
      const start = Math.max(0, end - vis + 1);
      const x = (i) => plotW - (end - i + 0.5 + pad) * bw;
      const last = Math.min(n - 1, end + pad);

      // Escala de precios
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = start; i <= last; i++) {
        lo = Math.min(lo, S.l[i]);
        hi = Math.max(hi, S.h[i]);
      }
      const span0 = hi - lo || hi * 0.01;
      const within = (p) => ok(p) && p > lo - span0 * 0.6 && p < hi + span0 * 0.6;
      if (this.offset === 0) {
        for (const ln of d.lines || []) if (within(ln.price)) {
          lo = Math.min(lo, ln.price);
          hi = Math.max(hi, ln.price);
        }
        if (cone) for (const r of cone) {
          lo = Math.min(lo, r.q5);
          hi = Math.max(hi, r.q95);
        }
      }
      const padP = (hi - lo) * 0.07 || hi * 0.002;
      lo -= padP;
      hi += padP;
      const y = (p) => 6 + ((hi - p) / (hi - lo)) * (mainH - 12);
      this.layout = { plotW, mainH, bw, end, pad, start, lo, hi, y, x, n };

      g.save();
      g.beginPath();
      g.rect(0, 0, plotW, H - axisH);
      g.clip();

      // Rejilla
      g.strokeStyle = C.grid;
      g.lineWidth = 1;
      const step = niceStep(hi - lo, Math.max(3, Math.floor(mainH / 55)));
      const ticks = [];
      for (let k = Math.ceil(lo / step); k * step <= hi; k++) ticks.push(k * step);
      for (const p of ticks) {
        const yy = Math.round(y(p)) + 0.5;
        g.beginPath();
        g.moveTo(0, yy);
        g.lineTo(plotW, yy);
        g.stroke();
      }
      const every = Math.max(1, Math.ceil(90 / bw));
      for (let i = start - (start % every); i <= last; i += every) {
        if (i < start) continue;
        const xx = Math.round(x(i)) + 0.5;
        g.beginPath();
        g.moveTo(xx, 0);
        g.lineTo(xx, H - axisH);
        g.stroke();
      }

      // Volumen (franja inferior del panel principal)
      let vmax = 0;
      for (let i = start; i <= last; i++) vmax = Math.max(vmax, S.v[i]);
      const volH = mainH * 0.16;
      const cw = Math.max(1, Math.min(16, bw * 0.72));
      g.globalAlpha = 0.28;
      for (let i = start; i <= last; i++) {
        const hh = vmax ? (S.v[i] / vmax) * volH : 0;
        g.fillStyle = S.c[i] >= S.o[i] ? C.up : C.down;
        g.fillRect(x(i) - cw / 2, mainH - hh, cw, hh);
      }
      g.globalAlpha = 1;

      const ind = d.ctx;
      const poly = (arr, color, width, dash, from, to, xf) => {
        g.strokeStyle = color;
        g.lineWidth = width || 1.3;
        g.setLineDash(dash || []);
        g.beginPath();
        let pen = false;
        for (let i = from == null ? start : from; i <= (to == null ? last : to); i++) {
          const v = arr[i];
          if (!ok(v)) {
            pen = false;
            continue;
          }
          const xx = xf ? xf(i) : x(i);
          if (pen) g.lineTo(xx, y(v));
          else g.moveTo(xx, y(v));
          pen = true;
        }
        g.stroke();
        g.setLineDash([]);
      };

      // Nube de Ichimoku (incluida la proyectada 26 velas hacia delante)
      if (this.show.ich && ind && ind.ich) {
        const A = ind.ich.senkouA.slice();
        const B = ind.ich.senkouB.slice();
        if (ahead) ahead.forEach((p, k) => {
          A[n + k] = p.a;
          B[n + k] = p.b;
        });
        const to = ahead ? n - 1 + ahead.length : last;
        for (let i = start; i < to; i++) {
          if (!ok(A[i]) || !ok(B[i]) || !ok(A[i + 1]) || !ok(B[i + 1])) continue;
          g.fillStyle = A[i] >= B[i] ? C.cloudUp : C.cloudDn;
          g.beginPath();
          g.moveTo(x(i), y(A[i]));
          g.lineTo(x(i + 1), y(A[i + 1]));
          g.lineTo(x(i + 1), y(B[i + 1]));
          g.lineTo(x(i), y(B[i]));
          g.closePath();
          g.fill();
        }
        poly(ind.ich.tenkan, C.ema20, 1, [3, 3]);
        poly(ind.ich.kijun, C.down, 1, [3, 3]);
      }

      // Bandas de Bollinger
      if (this.show.bb && ind && ind.bb) {
        g.fillStyle = C.grid;
        g.beginPath();
        let started = false;
        for (let i = start; i <= last; i++) if (ok(ind.bb.upper[i])) {
          if (started) g.lineTo(x(i), y(ind.bb.upper[i]));
          else g.moveTo(x(i), y(ind.bb.upper[i]));
          started = true;
        }
        for (let i = last; i >= start; i--) if (ok(ind.bb.lower[i])) g.lineTo(x(i), y(ind.bb.lower[i]));
        g.fill();
        poly(ind.bb.upper, C.bb, 1);
        poly(ind.bb.lower, C.bb, 1);
        poly(ind.bb.mid, C.bb, 1, [2, 3]);
      }

      // Medias móviles
      if (this.show.ema && ind) {
        poly(ind.ema20, C.ema20, 1.2);
        poly(ind.ema50, C.ema50, 1.4);
        poly(ind.ema200, C.ema200, 1.6);
      }

      const hline = (p, color, dash, width) => {
        const yy = Math.round(y(p)) + 0.5;
        g.strokeStyle = color;
        g.lineWidth = width || 1;
        g.setLineDash(dash || []);
        g.beginPath();
        g.moveTo(0, yy);
        g.lineTo(plotW, yy);
        g.stroke();
        g.setLineDash([]);
      };

      // Soportes y resistencias
      const tags = [];
      if (this.show.levels && d.levels) {
        for (const z of d.levels.supports.slice(0, 3)) {
          hline(z.price, C.up, [6, 4], Math.min(2.5, 0.6 + z.touches * 0.35));
          tags.push({ p: z.price, color: C.up, text: 'S' });
        }
        for (const z of d.levels.resistances.slice(0, 3)) {
          hline(z.price, C.down, [6, 4], Math.min(2.5, 0.6 + z.touches * 0.35));
          tags.push({ p: z.price, color: C.down, text: 'R' });
        }
      }
      // Fibonacci
      if (this.show.fib && d.fib) {
        g.font = `10px ${C.mono}`;
        g.textAlign = 'left';
        for (const r of d.fib.retr) {
          hline(r.price, C.fib, [2, 4]);
          g.fillStyle = C.fib;
          g.fillText((r.r * 100).toFixed(1) + ' %', 4, y(r.price) - 3);
        }
        g.font = `11px ${C.mono}`;
      }
      // Directrices de la figura chartista
      if (this.show.levels && d.figure) {
        g.strokeStyle = C.accent;
        g.lineWidth = 1.5;
        for (const ln of [d.figure.upper, d.figure.lower]) {
          g.beginPath();
          g.moveTo(x(ln.i1), y(ln.p1));
          g.lineTo(x(ln.i2), y(ln.p2));
          g.stroke();
        }
        g.fillStyle = C.accent;
        g.textAlign = 'right';
        g.fillText(d.figure.name, x(d.figure.upper.i2) - 4, y(d.figure.upper.p2) - 6);
      }

      // Velas
      for (let i = start; i <= last; i++) {
        const up = S.c[i] >= S.o[i];
        const col = up ? C.up : C.down;
        const xx = Math.round(x(i)) + 0.5;
        g.strokeStyle = col;
        g.fillStyle = col;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(xx, y(S.h[i]));
        g.lineTo(xx, y(S.l[i]));
        g.stroke();
        const yo = y(S.o[i]);
        const yc = y(S.c[i]);
        const top = Math.min(yo, yc);
        const hh = Math.max(1, Math.abs(yo - yc));
        if (cw >= 1.8) g.fillRect(Math.round(x(i) - cw / 2), top, Math.max(1, Math.round(cw)), hh);
      }

      // Cono de proyección
      if (cone) {
        const x0 = x(c0);
        const p0 = S.c[c0];
        const xf = (k) => x(c0 + k);
        const band = (qa, qb, alpha) => {
          g.globalAlpha = alpha;
          g.fillStyle = C.proj;
          g.beginPath();
          g.moveTo(x0, y(p0));
          cone.forEach((r) => g.lineTo(xf(r.k), y(r[qa])));
          for (let k = cone.length - 1; k >= 0; k--) g.lineTo(xf(cone[k].k), y(cone[k][qb]));
          g.closePath();
          g.fill();
          g.globalAlpha = 1;
        };
        band('q95', 'q5', 0.1);
        band('q75', 'q25', 0.18);
        g.strokeStyle = C.proj;
        g.setLineDash([4, 3]);
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x0, y(p0));
        cone.forEach((r) => g.lineTo(xf(r.k), y(r.q50)));
        g.stroke();
        g.setLineDash([]);
      }

      // Entrada, stop y objetivo de la señal actual
      if (this.offset === 0) {
        for (const ln of d.lines || []) {
          if (!within(ln.price) && !(ln.price >= lo && ln.price <= hi)) continue;
          const col = ln.kind === 'stop' ? C.down : ln.kind === 'target' ? C.up : C.accent;
          hline(ln.price, col, ln.kind === 'entry' ? [] : [8, 4], 1.4);
          tags.push({ p: ln.price, color: col, text: ln.label });
        }
      }

      // Señales
      for (const m of d.markers || []) {
        if (m.i < start || m.i > last) continue;
        const xx = x(m.i);
        const s = Math.max(5, Math.min(8, bw * 0.45));
        g.fillStyle = m.dir > 0 ? C.up : C.down;
        g.beginPath();
        if (m.dir > 0) {
          const yy = y(S.l[m.i]) + 6;
          g.moveTo(xx, yy);
          g.lineTo(xx - s, yy + s * 1.5);
          g.lineTo(xx + s, yy + s * 1.5);
        } else {
          const yy = y(S.h[m.i]) - 6;
          g.moveTo(xx, yy);
          g.lineTo(xx - s, yy - s * 1.5);
          g.lineTo(xx + s, yy - s * 1.5);
        }
        g.closePath();
        g.fill();
      }

      // Último precio
      const lastC = S.c[n - 1];
      const lastCol = S.c[n - 1] >= S.o[n - 1] ? C.up : C.down;
      hline(lastC, lastCol, [1, 3]);

      // Panel inferior
      if (lowerOn && ind) this._lower(g, C, ind, { start, last, x, lowTop, lowH, plotW, bw });
      g.restore();

      // Ejes
      g.fillStyle = C.surface;
      g.fillRect(plotW, 0, axisW, H);
      g.fillRect(0, H - axisH, W, axisH);
      g.strokeStyle = C.grid;
      g.beginPath();
      g.moveTo(plotW + 0.5, 0);
      g.lineTo(plotW + 0.5, H);
      g.moveTo(0, H - axisH + 0.5);
      g.lineTo(W, H - axisH + 0.5);
      if (lowerOn) {
        g.moveTo(0, mainH + 3.5);
        g.lineTo(W, mainH + 3.5);
      }
      g.stroke();
      g.fillStyle = C.ink3;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      for (const p of ticks) g.fillText(fp(p), plotW + 6, y(p));
      const tag = (p, color, text) => {
        const yy = y(p);
        if (yy < 0 || yy > mainH) return;
        g.fillStyle = color;
        g.fillRect(plotW + 1, yy - 8, axisW - 1, 16);
        g.fillStyle = '#fff';
        g.fillText(fp(p), plotW + 6, yy);
        if (text) {
          g.textAlign = 'right';
          g.fillStyle = color;
          g.fillText(text, plotW - 4, yy - 8);
          g.textAlign = 'left';
        }
      };
      for (const t of tags) tag(t.p, t.color, t.text);
      tag(lastC, lastCol);
      g.textAlign = 'center';
      g.fillStyle = C.ink3;
      const daily = (d.stepMs || 0) >= 86400e3;
      for (let i = start - (start % every); i <= Math.min(n - 1, last); i += every) {
        if (i < start) continue;
        const dt = new Date(S.t[i]);
        const label = daily || (dt.getHours() === 0 && dt.getMinutes() === 0) ? TF.day.format(dt) : TF.time.format(dt);
        g.fillText(label, x(i), H - axisH / 2);
      }

      // Cruz y leyenda
      let hi_ = n - 1;
      if (this.hover && this.hover.x < plotW) {
        hi_ = Math.round(end + pad + 0.5 - (plotW - this.hover.x) / bw - 0.5);
        hi_ = Math.max(start, Math.min(n - 1, hi_));
        const xx = Math.round(x(hi_)) + 0.5;
        g.strokeStyle = C.ink3;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(xx, 0);
        g.lineTo(xx, H - axisH);
        if (this.hover.y < mainH) {
          g.moveTo(0, Math.round(this.hover.y) + 0.5);
          g.lineTo(plotW, Math.round(this.hover.y) + 0.5);
        }
        g.stroke();
        g.setLineDash([]);
        if (this.hover.y < mainH) {
          const p = hi - ((this.hover.y - 6) / (mainH - 12)) * (hi - lo);
          g.fillStyle = C.ink2;
          g.fillRect(plotW + 1, this.hover.y - 8, axisW - 1, 16);
          g.fillStyle = C.surface;
          g.textAlign = 'left';
          g.fillText(fp(p), plotW + 6, this.hover.y);
        }
        const lab = TF.full.format(new Date(S.t[hi_]));
        const tw = g.measureText(lab).width + 12;
        g.fillStyle = C.ink2;
        g.fillRect(Math.min(W - tw, Math.max(0, xx - tw / 2)), H - axisH + 1, tw, axisH - 1);
        g.fillStyle = C.surface;
        g.textAlign = 'center';
        g.fillText(lab, Math.min(W - tw / 2, Math.max(tw / 2, xx)), H - axisH / 2);
      }
      const k = hi_;
      const ch = k > 0 ? (S.c[k] / S.c[k - 1] - 1) * 100 : 0;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.font = `11px ${C.mono}`;
      const parts = plotW < 440 ? [['Cie', S.c[k]]] : [['Ap', S.o[k]], ['Máx', S.h[k]], ['Mín', S.l[k]], ['Cie', S.c[k]]];
      let lx = 6;
      for (const [label, val] of parts) {
        g.fillStyle = C.ink3;
        g.fillText(label, lx, 6);
        lx += g.measureText(label + ' ').width;
        g.fillStyle = C.ink;
        const tv = fp(val) + '  ';
        g.fillText(tv, lx, 6);
        lx += g.measureText(tv).width;
      }
      g.fillStyle = ch >= 0 ? C.up : C.down;
      g.fillText((ch >= 0 ? '+' : '') + ch.toFixed(2) + ' %', lx, 6);
      g.textBaseline = 'alphabetic';
    }

    _lower(g, C, ind, L) {
      const { start, last, x, lowTop, lowH, plotW, bw } = L;
      const yv = (v, a, b) => lowTop + 4 + ((b - v) / (b - a)) * (lowH - 8);
      const guide = (v, a, b) => {
        const yy = Math.round(yv(v, a, b)) + 0.5;
        g.strokeStyle = C.grid;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(0, yy);
        g.lineTo(plotW, yy);
        g.stroke();
        g.setLineDash([]);
      };
      const line = (arr, color, a, b) => {
        g.strokeStyle = color;
        g.lineWidth = 1.3;
        g.beginPath();
        let pen = false;
        for (let i = start; i <= last; i++) {
          if (!ok(arr[i])) {
            pen = false;
            continue;
          }
          const yy = yv(arr[i], a, b);
          if (pen) g.lineTo(x(i), yy);
          else g.moveTo(x(i), yy);
          pen = true;
        }
        g.stroke();
      };
      g.font = `10px ${C.mono}`;
      g.textBaseline = 'top';
      g.textAlign = 'left';
      let title = '';
      if (this.lower === 'rsi') {
        [30, 50, 70].forEach((v) => guide(v, 0, 100));
        line(ind.rsi, C.accent, 0, 100);
        title = 'RSI 14  ' + (ok(ind.rsi[last]) ? ind.rsi[last].toFixed(1) : '');
      } else if (this.lower === 'macd') {
        let m = 0;
        for (let i = start; i <= last; i++) m = Math.max(m, Math.abs(ind.macd.line[i]) || 0, Math.abs(ind.macd.signal[i]) || 0, Math.abs(ind.macd.hist[i]) || 0);
        m = m || 1;
        guide(0, -m, m);
        const cw = Math.max(1, Math.min(14, bw * 0.6));
        for (let i = start; i <= last; i++) {
          const v = ind.macd.hist[i];
          if (!ok(v)) continue;
          g.fillStyle = v >= 0 ? C.up : C.down;
          g.globalAlpha = 0.5;
          const y0 = yv(0, -m, m);
          const y1 = yv(v, -m, m);
          g.fillRect(x(i) - cw / 2, Math.min(y0, y1), cw, Math.abs(y1 - y0));
          g.globalAlpha = 1;
        }
        line(ind.macd.line, C.ema20, -m, m);
        line(ind.macd.signal, C.ema50, -m, m);
        title = 'MACD 12 26 9';
      } else if (this.lower === 'stoch') {
        [20, 80].forEach((v) => guide(v, 0, 100));
        line(ind.stoch.k, C.ema20, 0, 100);
        line(ind.stoch.d, C.ema50, 0, 100);
        title = 'Estocástico 14 3 3';
      }
      g.fillStyle = C.ink3;
      g.fillText(title, 6, lowTop + 4);
      g.textBaseline = 'alphabetic';
    }

    _bind() {
      const cv = this.cv;
      const dist = () => {
        const [a, b] = Array.from(this.pointers.values());
        return Math.hypot(a.x - b.x, a.y - b.y) || 1;
      };
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
      }, { passive: false });
      cv.addEventListener('pointerdown', (e) => {
        try {
          cv.setPointerCapture(e.pointerId);
        } catch (err) {
          /* no disponible */
        }
        this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        this.drag = { x: e.offsetX, offset: this.offset };
        if (this.pointers.size === 2) this.pinch = { d: dist(), visible: this.visible };
      });
      cv.addEventListener('pointermove', (e) => {
        const p = this.pointers.get(e.pointerId);
        if (p) {
          p.x = e.offsetX;
          p.y = e.offsetY;
        }
        if (this.pinch && this.pointers.size === 2) {
          this.visible = Math.round((this.pinch.visible * this.pinch.d) / dist());
          this.clamp();
          this.draw();
          return;
        }
        if (p && this.drag && this.layout) {
          this.offset = this.drag.offset + Math.round((e.offsetX - this.drag.x) / this.layout.bw);
          this.clamp();
        }
        this.hover = { x: e.offsetX, y: e.offsetY };
        this.draw();
      });
      const up = (e) => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        if (!this.pointers.size) this.drag = null;
        if (e.pointerType !== 'mouse') this.hover = null;
        this.draw();
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', () => {
        if (!this.pointers.size) {
          this.hover = null;
          this.draw();
        }
      });
      cv.addEventListener('dblclick', () => this.reset());
    }
  }

  // Línea simple (curva de capital del backtest).
  function lineChart(canvas, values, opts) {
    opts = opts || {};
    const box = canvas.parentElement.getBoundingClientRect();
    const dpr = root.devicePixelRatio || 1;
    const W = Math.max(200, Math.floor(box.width));
    const H = opts.height || 180;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (values.length < 2) return;
    const cs = getComputedStyle(canvas);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    const mono = v('--font-mono', 'monospace');
    let lo = Math.min(...values, opts.base == null ? Infinity : opts.base);
    let hi = Math.max(...values, opts.base == null ? -Infinity : opts.base);
    const p = (hi - lo) * 0.08 || 1;
    lo -= p;
    hi += p;
    const left = 52;
    const x = (k) => left + (k / (values.length - 1)) * (W - left - 8);
    const y = (val) => 8 + ((hi - val) / (hi - lo)) * (H - 24);
    g.font = `10px ${mono}`;
    g.fillStyle = v('--ink-3', '#999');
    g.textBaseline = 'middle';
    const step = niceStep(hi - lo, 4);
    g.strokeStyle = v('--grid', 'rgba(127,127,127,.15)');
    for (let k = Math.ceil(lo / step); k * step <= hi; k++) {
      const yy = Math.round(y(k * step)) + 0.5;
      g.beginPath();
      g.moveTo(left, yy);
      g.lineTo(W, yy);
      g.stroke();
      g.fillText((k * step).toFixed(0), 4, yy);
    }
    if (opts.base != null) {
      g.strokeStyle = v('--ink-3', '#999');
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(left, y(opts.base));
      g.lineTo(W, y(opts.base));
      g.stroke();
      g.setLineDash([]);
    }
    const end = values[values.length - 1];
    g.strokeStyle = end >= (opts.base == null ? values[0] : opts.base) ? v('--up', '#1f9d6b') : v('--down', '#d6453d');
    g.lineWidth = 2;
    g.beginPath();
    values.forEach((val, k) => (k ? g.lineTo(x(k), y(val)) : g.moveTo(x(k), y(val))));
    g.stroke();
  }

  FX.Chart = Chart;
  FX.lineChart = lineChart;
})(typeof globalThis !== 'undefined' ? globalThis : this);
