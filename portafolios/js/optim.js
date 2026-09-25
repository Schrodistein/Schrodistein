/* Optimización de Markowitz con límites por activo.
 *
 * Todo se reduce a un mismo problema cuadrático:
 *     min ½ w'Σw − c'w   s.a.  Σw = 1,  lo ≤ w ≤ hi
 * resuelto exactamente por conjunto activo. Con c = t·μ y t de 0 a ∞ se recorre
 * la frontera eficiente (t = 0 es la cartera de mínima varianza). */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const { dot, matVec, quad, solve } = PF.stats;

  const toArr = (b, n) => (Array.isArray(b) ? b.slice() : new Array(n).fill(b));

  function feasible(lo, hi) {
    const sl = lo.reduce((s, x) => s + x, 0);
    const sh = hi.reduce((s, x) => s + x, 0);
    return sl <= 1 + 1e-9 && sh >= 1 - 1e-9 && lo.every((l, i) => l <= hi[i] + 1e-12);
  }

  /* Proyección euclídea sobre {Σw = 1, lo ≤ w ≤ hi} por bisección del desplazamiento. */
  function projectBoxSimplex(v, lo, hi) {
    const n = v.length;
    const s = (tau) => {
      let r = 0;
      for (let i = 0; i < n; i++) r += Math.min(hi[i], Math.max(lo[i], v[i] - tau));
      return r;
    };
    let a = Math.min(...v.map((x, i) => x - hi[i])) - 1;
    let b = Math.max(...v.map((x, i) => x - lo[i])) + 1;
    for (let k = 0; k < 200; k++) {
      const m = (a + b) / 2;
      if (s(m) > 1) a = m;
      else b = m;
    }
    const tau = (a + b) / 2;
    const w = v.map((x, i) => Math.min(hi[i], Math.max(lo[i], x - tau)));
    // Ajuste fino del redondeo sobre una variable interior
    const err = 1 - w.reduce((q, x) => q + x, 0);
    const k = w.findIndex((x, i) => x + err >= lo[i] && x + err <= hi[i]);
    if (k >= 0) w[k] += err;
    return w;
  }

  /* Conjunto activo primal para  min ½ w'Sw − c'w,  1'w = 1,  lo ≤ w ≤ hi.
   * S debe ser simétrica definida positiva (se añade un pequeño ridge). */
  function solveQP(S0, c, loIn, hiIn, w0) {
    const n = c.length;
    const lo = toArr(loIn, n);
    const hi = toArr(hiIn, n);
    if (!feasible(lo, hi)) throw new Error('Límites de peso incompatibles: la suma de mínimos supera 100 % o la de máximos no llega a 100 %.');
    let tr = 0;
    for (let i = 0; i < n; i++) tr += S0[i][i];
    const ridge = 1e-12 * (tr / n || 1);
    const S = S0.map((row, i) => row.map((x, j) => (i === j ? x + ridge : x)));
    const scale = Math.max(tr / n, ...c.map(Math.abs), 1e-12);
    const tol = 1e-11 * scale;

    let w = projectBoxSimplex(w0 || new Array(n).fill(1 / n), lo, hi);
    // estado: −1 en el mínimo, 1 en el máximo, 0 libre
    const st = w.map((x, i) => (x <= lo[i] + 1e-12 ? -1 : x >= hi[i] - 1e-12 ? 1 : 0));
    st.forEach((s, i) => {
      if (s === -1) w[i] = lo[i];
      if (s === 1) w[i] = hi[i];
    });

    for (let iter = 0; iter < 100 * n + 200; iter++) {
      const F = [];
      const B = [];
      st.forEach((s, i) => (s === 0 ? F : B).push(i));
      let lambda;
      if (F.length === 0) {
        const g = matVec(S, w).map((x, i) => x - c[i]);
        let L = -Infinity;
        let U = Infinity;
        let jL = -1;
        for (const i of B) {
          if (st[i] === -1 && -g[i] > L) {
            L = -g[i];
            jL = i;
          }
          if (st[i] === 1 && -g[i] < U) U = -g[i];
        }
        if (L <= U + tol) return w;
        st[jL] = 0;
        continue;
      }
      // Sistema KKT en las variables libres
      const m = F.length;
      const A = [];
      const rhs = [];
      let fixedSum = 0;
      for (const j of B) fixedSum += w[j];
      for (let a = 0; a < m; a++) {
        const i = F[a];
        const row = F.map((j) => S[i][j]);
        row.push(1);
        A.push(row);
        let r = c[i];
        for (const j of B) r -= S[i][j] * w[j];
        rhs.push(r);
      }
      A.push(new Array(m).fill(1).concat([0]));
      rhs.push(1 - fixedSum);
      const x = solve(A, rhs);
      lambda = x[m];
      // Paso hacia la solución, recortado por el primer límite que se alcance
      let alpha = 1;
      let block = -1;
      let side = 0;
      for (let a = 0; a < m; a++) {
        const i = F[a];
        const d = x[a] - w[i];
        if (d < -1e-15) {
          const s = (lo[i] - w[i]) / d;
          if (s < alpha) {
            alpha = s;
            block = i;
            side = -1;
          }
        } else if (d > 1e-15) {
          const s = (hi[i] - w[i]) / d;
          if (s < alpha) {
            alpha = s;
            block = i;
            side = 1;
          }
        }
      }
      alpha = Math.max(0, alpha);
      for (let a = 0; a < m; a++) w[F[a]] += alpha * (x[a] - w[F[a]]);
      if (block >= 0) {
        w[block] = side === -1 ? lo[block] : hi[block];
        st[block] = side;
        continue;
      }
      // Paso completo: comprobar multiplicadores de los límites activos
      const g = matVec(S, w).map((v, i) => v - c[i]);
      let worst = tol;
      let rel = -1;
      for (const i of B) {
        const mu = g[i] + lambda;
        const viol = st[i] === -1 ? -mu : mu;
        if (viol > worst) {
          worst = viol;
          rel = i;
        }
      }
      if (rel < 0) return w;
      st[rel] = 0;
    }
    return w;
  }

  /* Gradiente proyectado acelerado (FISTA): más lento, sirve de referencia en las pruebas. */
  function solveQPGradient(S, c, loIn, hiIn, iters) {
    const n = c.length;
    const lo = toArr(loIn, n);
    const hi = toArr(hiIn, n);
    let L = 0;
    for (const row of S) L = Math.max(L, row.reduce((s, x) => s + Math.abs(x), 0));
    let w = projectBoxSimplex(new Array(n).fill(1 / n), lo, hi);
    let y = w.slice();
    let t = 1;
    for (let k = 0; k < (iters || 20000); k++) {
      const g = matVec(S, y).map((v, i) => v - c[i]);
      const wn = projectBoxSimplex(y.map((v, i) => v - g[i] / L), lo, hi);
      const tn = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
      y = wn.map((v, i) => v + ((t - 1) / tn) * (v - w[i]));
      w = wn;
      t = tn;
    }
    return w;
  }

  /* Cartera de máximo rendimiento con límites: llenar primero los activos de mayor μ. */
  function maxReturn(mu, loIn, hiIn) {
    const n = mu.length;
    const lo = toArr(loIn, n);
    const hi = toArr(hiIn, n);
    const w = lo.slice();
    let rest = 1 - lo.reduce((s, x) => s + x, 0);
    const order = mu.map((m, i) => i).sort((a, b) => mu[b] - mu[a]);
    for (const i of order) {
      const add = Math.min(hi[i] - lo[i], rest);
      w[i] += add;
      rest -= add;
    }
    return w;
  }

  const point = (S, mu, w, t) => ({ t, w, ret: dot(mu, w), vol: Math.sqrt(Math.max(0, quad(S, w))) });

  /* Frontera eficiente: barrido geométrico de t con refinamiento donde el salto en σ es grande. */
  function frontier(S, mu, lo, hi, opts) {
    const n = mu.length;
    const o = Object.assign({ points: 60 }, opts);
    const avgVar = S.reduce((s, r, i) => s + r[i], 0) / n;
    const spread = Math.max(...mu) - Math.min(...mu) || Math.abs(mu[0]) || 1;
    const t0 = (avgVar / spread) * 1e-3;
    const pts = [point(S, mu, solveQP(S, new Array(n).fill(0), lo, hi), 0)];
    const top = point(S, mu, maxReturn(mu, lo, hi), Infinity);
    let prev = pts[0].w;
    for (let k = 0; k < o.points; k++) {
      const t = t0 * Math.pow(10, (6 * k) / (o.points - 1));
      const w = solveQP(S, mu.map((m) => t * m), lo, hi, prev);
      prev = w;
      pts.push(point(S, mu, w, t));
      if (top.ret - pts[pts.length - 1].ret < 1e-10 * (Math.abs(top.ret) + 1)) break;
    }
    pts.push(top);
    // Refinar huecos visibles (más de 1/40 del rango de σ)
    const range = top.vol - pts[0].vol || 1;
    for (let pass = 0; pass < 3; pass++) {
      for (let k = pts.length - 2; k >= 0; k--) {
        const a = pts[k];
        const b = pts[k + 1];
        if (b.vol - a.vol > range / 40 && Number.isFinite(b.t)) {
          const t = a.t === 0 ? b.t / 2 : Math.sqrt(a.t * b.t);
          pts.splice(k + 1, 0, point(S, mu, solveQP(S, mu.map((m) => t * m), lo, hi, a.w), t));
        }
      }
    }
    // Quitar duplicados
    return pts.filter((p, i) => i === 0 || Math.abs(p.vol - pts[i - 1].vol) > 1e-9 || Math.abs(p.ret - pts[i - 1].ret) > 1e-9);
  }

  /* Solución de la frontera para un t dado (t = Infinity → máximo rendimiento). */
  function atT(S, mu, lo, hi, t, w0) {
    if (!Number.isFinite(t)) return point(S, mu, maxReturn(mu, lo, hi), t);
    return point(S, mu, solveQP(S, mu.map((m) => t * m), lo, hi, w0), t);
  }

  /* Máximo de (c'w − r0)/σ(w): razón de Sharpe (c = μ, r0 = rf) o razón de
   * diversificación (c = σ, r0 = 0). La cartera óptima está en la frontera de c,
   * y a lo largo de ella la razón es unimodal: rejilla + sección áurea en t. */
  function maxRatio(S, c, r0, lo, hi, front) {
    const pts = front || frontier(S, c, lo, hi);
    const ratio = (p) => (p.vol > 0 ? (dot(c, p.w) - r0) / p.vol : -Infinity);
    let k = 0;
    pts.forEach((p, i) => {
      if (ratio(p) > ratio(pts[k])) k = i;
    });
    let best = pts[k];
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(pts.length - 1, k + 1)];
    let ta = a.t;
    let tb = Number.isFinite(b.t) ? b.t : Math.max(best.t, a.t, 1e-12) * 1e3;
    if (tb > ta) {
      const g = (Math.sqrt(5) - 1) / 2;
      const f = (t) => atT(S, c, lo, hi, t, best.w);
      let x1 = tb - g * (tb - ta);
      let x2 = ta + g * (tb - ta);
      let p1 = f(x1);
      let p2 = f(x2);
      for (let it = 0; it < 60; it++) {
        if (ratio(p1) < ratio(p2)) {
          ta = x1;
          x1 = x2;
          p1 = p2;
          x2 = ta + g * (tb - ta);
          p2 = f(x2);
        } else {
          tb = x2;
          x2 = x1;
          p2 = p1;
          x1 = tb - g * (tb - ta);
          p1 = f(x1);
        }
      }
      for (const p of [p1, p2]) if (ratio(p) > ratio(best)) best = p;
    }
    return { w: best.w, ratio: ratio(best) };
  }

  /* Paridad de riesgo (contribución igual al riesgo), descenso cíclico por coordenadas. */
  function riskParity(S) {
    const n = S.length;
    let x = S.map((r, i) => 1 / Math.sqrt(r[i]));
    const b = 1 / n;
    for (let it = 0; it < 500; it++) {
      let maxDelta = 0;
      for (let i = 0; i < n; i++) {
        let q = 0;
        for (let j = 0; j < n; j++) if (j !== i) q += S[i][j] * x[j];
        const xi = (-q + Math.sqrt(q * q + 4 * S[i][i] * b)) / (2 * S[i][i]);
        maxDelta = Math.max(maxDelta, Math.abs(xi - x[i]) / (Math.abs(x[i]) + 1e-300));
        x[i] = xi;
      }
      if (maxDelta < 1e-12) break;
    }
    const s = x.reduce((a, v) => a + v, 0);
    return x.map((v) => v / s);
  }

  /* Punto de la frontera (restringida por lo/hi) con la volatilidad dada: máximo rendimiento a igual riesgo. */
  function frontierAtVol(S, mu, lo, hi, front, vol) {
    if (vol <= front[0].vol) return front[0];
    const last = front[front.length - 1];
    if (vol >= last.vol) return last;
    let k = front.findIndex((p) => p.vol >= vol);
    let a = front[k - 1];
    let b = front[k];
    if (!Number.isFinite(b.t)) {
      // Entre el último t finito y la cartera de máximo rendimiento
      let t = Math.max(a.t, 1e-12);
      let p = a;
      for (let i = 0; i < 80 && p.vol < vol; i++) {
        t *= 2;
        p = atT(S, mu, lo, hi, t, p.w);
        if (p.vol < vol) a = p;
        else b = p;
      }
    }
    for (let i = 0; i < 80; i++) {
      const t = a.t === 0 ? b.t / 2 : Math.sqrt(a.t * b.t);
      const p = atT(S, mu, lo, hi, t, a.w);
      if (p.vol < vol) a = p;
      else b = p;
      if (b.vol - a.vol < 1e-10) break;
    }
    return Math.abs(a.vol - vol) < Math.abs(b.vol - vol) ? a : b;
  }

  /* Punto de la frontera con el rendimiento dado: mínimo riesgo a igual rendimiento. */
  function frontierAtRet(S, mu, lo, hi, front, ret) {
    if (ret <= front[0].ret) return front[0];
    const last = front[front.length - 1];
    if (ret >= last.ret) return last;
    let k = front.findIndex((p) => p.ret >= ret);
    let a = front[k - 1];
    let b = front[k];
    if (!Number.isFinite(b.t)) {
      let t = Math.max(a.t, 1e-12);
      let p = a;
      for (let i = 0; i < 80 && p.ret < ret; i++) {
        t *= 2;
        p = atT(S, mu, lo, hi, t, p.w);
        if (p.ret < ret) a = p;
        else b = p;
      }
    }
    for (let i = 0; i < 80; i++) {
      const t = a.t === 0 ? b.t / 2 : Math.sqrt(a.t * b.t);
      const p = atT(S, mu, lo, hi, t, a.w);
      if (p.ret < ret) a = p;
      else b = p;
      if (b.ret - a.ret < 1e-12) break;
    }
    return b;
  }

  PF.optim = { solveQP, solveQPGradient, projectBoxSimplex, maxReturn, frontier, maxRatio, riskParity, frontierAtVol, frontierAtRet, feasible, toArr };
})(typeof globalThis !== 'undefined' ? globalThis : this);
