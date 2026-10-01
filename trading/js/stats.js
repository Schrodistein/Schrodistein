/* Análisis cuantitativo y proyección probabilística.
 *
 * - Régimen: exponente de Hurst (R/S con la corrección de Anis-Lloyd-Peters)
 *   y test del ratio de varianzas de Lo-MacKinlay: ¿el activo tiende a
 *   continuar sus movimientos (tendencia) o a revertirlos (rango)?
 * - Volatilidad: GARCH(1,1) ajustado por máxima verosimilitud (rejilla con
 *   variance targeting) y su previsión a h velas.
 * - Proyección: simulación histórica filtrada (Monte Carlo con los residuos
 *   estandarizados del GARCH, que conservan las colas gruesas reales) →
 *   cono de precios y probabilidad de tocar el objetivo antes que el stop.
 * - Tasas base empíricas: qué pasó realmente en este activo tras situaciones
 *   con el mismo sesgo, con intervalo de confianza de Wilson. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});

  function logReturns(c) {
    const out = [];
    for (let i = 1; i < c.length; i++) out.push(Math.log(c[i] / c[i - 1]));
    return out;
  }
  const mean = (x) => x.reduce((s, v) => s + v, 0) / (x.length || 1);
  function variance(x, m) {
    m = m == null ? mean(x) : m;
    let s = 0;
    for (const v of x) s += (v - m) ** 2;
    return s / Math.max(1, x.length - 1);
  }
  function moments(x) {
    const m = mean(x);
    const sd = Math.sqrt(variance(x, m));
    let s3 = 0;
    let s4 = 0;
    for (const v of x) {
      const z = (v - m) / (sd || 1);
      s3 += z ** 3;
      s4 += z ** 4;
    }
    return { mean: m, sd, skew: s3 / x.length, kurt: s4 / x.length - 3 };
  }
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function slope(xs, ys) {
    const mx = mean(xs);
    const my = mean(ys);
    let a = 0;
    let b = 0;
    for (let k = 0; k < xs.length; k++) {
      a += (xs[k] - mx) * (ys[k] - my);
      b += (xs[k] - mx) ** 2;
    }
    return a / b;
  }

  // log Γ(x) (aproximación de Lanczos).
  function lgamma(x) {
    const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = 0.99999999999980993;
    const t = x + 7.5;
    for (let k = 0; k < 8; k++) a += g[k] / (x + k + 1);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  /* ---------- Régimen ---------- */
  const ERS = {};
  function expectedRS(n) {
    if (ERS[n]) return ERS[n];
    let s = 0;
    for (let k = 1; k < n; k++) s += Math.sqrt((n - k) / k);
    const g = n <= 340 ? Math.exp(lgamma((n - 1) / 2) - lgamma(n / 2)) / Math.sqrt(Math.PI) : 1 / Math.sqrt((n * Math.PI) / 2);
    return (ERS[n] = ((n - 0.5) / n) * g * s);
  }
  function rescaledRange(x, from, n) {
    let m = 0;
    for (let k = from; k < from + n; k++) m += x[k];
    m /= n;
    let cum = 0;
    let mx = 0;
    let mn = 0;
    let ss = 0;
    for (let k = from; k < from + n; k++) {
      const d = x[k] - m;
      cum += d;
      ss += d * d;
      if (cum > mx) mx = cum;
      if (cum < mn) mn = cum;
    }
    const sd = Math.sqrt(ss / n);
    return sd > 0 ? (mx - mn) / sd : NaN;
  }
  // H ≈ 0,5: paseo aleatorio; > 0,5: persistente (tendencias); < 0,5: antipersistente (reversión).
  function hurst(r) {
    const N = r.length;
    const sizes = [8, 16, 32, 64, 128, 256].filter((n) => n <= N / 2);
    if (sizes.length < 3) return NaN;
    const xs = [];
    const ys = [];
    const ye = [];
    for (const n of sizes) {
      const chunks = Math.floor(N / n);
      const start = N - chunks * n;
      let s = 0;
      let cnt = 0;
      for (let k = 0; k < chunks; k++) {
        const rs = rescaledRange(r, start + k * n, n);
        if (Number.isFinite(rs)) {
          s += rs;
          cnt++;
        }
      }
      if (!cnt) continue;
      xs.push(Math.log(n));
      ys.push(Math.log(s / cnt));
      ye.push(Math.log(expectedRS(n)));
    }
    if (xs.length < 3) return NaN;
    return 0.5 + slope(xs, ys) - slope(xs, ye);
  }

  // Ratio de varianzas de Lo-MacKinlay con estadístico z (homocedástico).
  function varianceRatio(r, q) {
    const N = r.length;
    if (N < 4 * q) return { vr: NaN, z: NaN };
    const mu = mean(r);
    const v1 = variance(r, mu);
    let vq = 0;
    let s = 0;
    for (let t = 0; t < N; t++) {
      s += r[t];
      if (t >= q) s -= r[t - q];
      if (t >= q - 1) vq += (s - q * mu) ** 2;
    }
    vq /= q * (N - q + 1) * (1 - q / N);
    const vr = vq / v1;
    return { vr, z: (vr - 1) / Math.sqrt((2 * (2 * q - 1) * (q - 1)) / (3 * q * N)) };
  }

  function autocorr(r, lag) {
    const m = mean(r);
    let a = 0;
    let b = 0;
    for (let t = 0; t < r.length; t++) {
      b += (r[t] - m) ** 2;
      if (t >= lag) a += (r[t] - m) * (r[t - lag] - m);
    }
    return b ? a / b : 0;
  }

  /* ---------- GARCH(1,1) ---------- */
  function garch(r) {
    const N = r.length;
    const mu = mean(r);
    const e = r.map((x) => x - mu);
    const v = variance(e, 0);
    const run = (al, be) => {
      const w = v * (1 - al - be);
      let h = v;
      let ll = 0;
      for (let t = 0; t < N; t++) {
        ll += -0.5 * (Math.log(h) + (e[t] * e[t]) / h);
        h = w + al * e[t] * e[t] + be * h;
      }
      return { ll, next: h };
    };
    let best = { al: 0, be: 0, ...run(0, 0) };
    const tryAt = (al, be) => {
      if (al < 0.005 || be < 0 || al + be >= 0.995) return;
      const rr = run(al, be);
      if (rr.ll > best.ll) best = { al, be, ...rr };
    };
    for (let al = 0.02; al <= 0.2001; al += 0.02) for (let be = 0.6; be <= 0.9801; be += 0.02) tryAt(al, be);
    const a0 = best.al;
    const b0 = best.be;
    for (let da = -0.015; da <= 0.0151; da += 0.005) for (let db = -0.015; db <= 0.0151; db += 0.005) tryAt(a0 + da, b0 + db);
    const omega = v * (1 - best.al - best.be);
    const h = [];
    let hv = v;
    for (let t = 0; t < N; t++) {
      h.push(hv);
      hv = omega + best.al * e[t] * e[t] + best.be * hv;
    }
    const z = e.map((x, t) => x / Math.sqrt(h[t]));
    return { mu, omega, alpha: best.al, beta: best.be, persistence: best.al + best.be, lr: v, next: hv, h, z, ll: best.ll };
  }
  // Varianza prevista k velas hacia delante (k ≥ 1).
  const forecastVar = (g, k) => g.lr + Math.pow(g.persistence, k - 1) * (g.next - g.lr);

  /* ---------- Simulación histórica filtrada ---------- */
  function simulate(price, g, opts) {
    const H = opts.horizon;
    const P = opts.paths || 2000;
    const R = FX.util.rng(opts.seed == null ? 12345 : opts.seed);
    const mu = opts.drift || 0;
    const z = g.z.length ? g.z : [0];
    const cols = Array.from({ length: H }, () => new Float64Array(P));
    const up = opts.up ? Math.log(opts.up) : null;
    const dn = opts.down ? Math.log(opts.down) : null;
    let hitUp = 0;
    let hitDn = 0;
    const x0 = Math.log(price);
    for (let p = 0; p < P; p++) {
      let h = g.next;
      let x = x0;
      let done = up == null && dn == null;
      for (let k = 0; k < H; k++) {
        const eps = Math.sqrt(h) * z[Math.floor(R() * z.length)];
        const x1 = x + mu + eps;
        if (!done) {
          // Puente browniano: probabilidad de tocar la barrera dentro de la vela.
          const crossD = dn != null && (x1 <= dn || (x > dn && R() < Math.exp((-2 * (x - dn) * (x1 - dn)) / h)));
          const crossU = up != null && (x1 >= up || (x < up && R() < Math.exp((-2 * (up - x) * (up - x1)) / h)));
          if (crossD) {
            hitDn++;
            done = true;
          } else if (crossU) {
            hitUp++;
            done = true;
          }
        }
        x = x1;
        h = g.omega + g.alpha * eps * eps + g.beta * h;
        cols[k][p] = Math.exp(x);
      }
    }
    const qs = [0.05, 0.25, 0.5, 0.75, 0.95];
    const cone = cols.map((col, k) => {
      const s = Array.from(col).sort((a, b) => a - b);
      const row = { k: k + 1 };
      qs.forEach((q) => (row['q' + Math.round(q * 100)] = quantile(s, q)));
      return row;
    });
    return { cone, pUp: hitUp / P, pDown: hitDn / P, pNone: 1 - (hitUp + hitDn) / P };
  }

  /* ---------- Tasas base empíricas ---------- */
  function wilson(k, n, z) {
    z = z || 1.96;
    if (!n) return [0, 1];
    const p = k / n;
    const d = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / d;
    const w = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [Math.max(0, c - w), Math.min(1, c + w)];
  }
  /* Rentabilidad a H velas tras cada vela con el sesgo pedido, usando
   * muestras que no se solapan (separadas al menos H velas) para que el
   * intervalo de confianza no sea artificialmente estrecho. */
  function baseRates(close, bias, from, to, H, sign) {
    const pick = (cond) => {
      let n = 0;
      let up = 0;
      let sum = 0;
      let last = -Infinity;
      for (let j = from; j + H <= to; j++) {
        if (j - last < H || !cond(j)) continue;
        const r = Math.log(close[j + H] / close[j]);
        n++;
        if (r > 0) up++;
        sum += r;
        last = j;
      }
      return { n, up, pUp: n ? up / n : NaN, ci: wilson(up, n), meanRet: n ? Math.expm1(sum / n) : NaN };
    };
    const all = pick(() => true);
    const cond = sign ? pick((j) => Number.isFinite(bias[j]) && Math.sign(bias[j]) === sign && Math.abs(bias[j]) >= 1) : null;
    return { horizon: H, all, cond, sign };
  }

  /* ---------- Proyección completa ---------- */
  function project(ctx, i, opts) {
    opts = opts || {};
    const H = opts.horizon || 24;
    const c = ctx.S.c.slice(0, i + 1);
    const r = logReturns(c).slice(-1500);
    if (r.length < 120) return null;
    const g = garch(r);
    const stepMs = ctx.stepMs || 3600e3;
    const perYear = (365 * 86400e3) / stepMs;
    const hs = g.h.slice().sort((a, b) => a - b);
    let rank = 0;
    while (rank < hs.length && hs[rank] <= g.next) rank++;
    let cum = 0;
    for (let k = 1; k <= H; k++) cum += forecastVar(g, k);
    const sig = opts.signal && opts.signal.dir ? opts.signal : null;
    const sim = simulate(c[i], g, {
      horizon: H, paths: opts.paths || 2000, seed: opts.seed,
      up: sig ? (sig.dir > 0 ? sig.target : sig.stop) : null,
      down: sig ? (sig.dir > 0 ? sig.stop : sig.target) : null,
    });
    const h = hurst(r.slice(-512));
    const vr = varianceRatio(r, 4);
    const regime = !Number.isFinite(h) ? 'indeterminado' : h > 0.55 ? 'persistente' : h < 0.45 ? 'antipersistente' : 'aleatorio';
    let hit = null;
    if (sig) {
      const pT = sig.dir > 0 ? sim.pUp : sim.pDown;
      const pS = sig.dir > 0 ? sim.pDown : sim.pUp;
      // Probabilidad de acierto necesaria para no perder con este R:R (sin contar comisiones).
      hit = { target: pT, stop: pS, none: sim.pNone, breakeven: 1 / (1 + (sig.rr || 2)) };
    }
    return {
      horizon: H,
      price: c[i],
      garch: { alpha: g.alpha, beta: g.beta, persistence: g.persistence },
      volBar: Math.sqrt(g.next),
      volAnnual: Math.sqrt(g.next * perYear),
      volLongAnnual: Math.sqrt(g.lr * perYear),
      volPercentile: rank / hs.length,
      sigmaH: Math.sqrt(cum),
      moments: moments(r),
      hurst: h,
      varianceRatio: vr,
      autocorr1: autocorr(r, 1),
      regime,
      cone: sim.cone,
      hit,
      base: opts.bias ? baseRates(ctx.S.c, opts.bias, opts.from || 0, i, H, opts.biasSign || 0) : null,
    };
  }

  FX.stats = {
    logReturns, mean, variance, moments, quantile, lgamma, expectedRS, hurst, varianceRatio, autocorr, garch, forecastVar,
    simulate, wilson, baseRates, project,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
