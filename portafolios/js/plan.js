/* Plan de inversión para un presupuesto.
 *
 * 1. Reparto entre el portafolio riesgoso y la renta fija segura (CDT o TES corto) según el
 *    horizonte (separación de Tobin con el criterio de «primero la seguridad» de Roy): la mayor
 *    parte en el portafolio riesgoso con la que la probabilidad de terminar el horizonte con
 *    pérdida no pasa del límite elegido.
 * 2. Dentro del portafolio riesgoso: acciones enteras (acciones y ETF) o montos en pesos
 *    (renta fija, divisas, derivados), con un monto mínimo por inversión y comisión fija por
 *    compra y por venta. La comisión es un costo fijo por activo, así que con presupuestos
 *    pequeños conviene tener menos activos: se prueba quedarse con los k de mayor peso,
 *    reoptimizando con ellos, y se elige el k con mejor razón de Sharpe neta en el horizonte,
 *    contando solo la mejora que viene de pagar menos comisiones. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});

  const normCdf = (x) => PF.stats.normalCdf(x);
  function normInv(p) {
    let a = -10;
    let b = 10;
    for (let i = 0; i < 100; i++) {
      const c = (a + b) / 2;
      if (normCdf(c) < p) a = c;
      else b = c;
    }
    return (a + b) / 2;
  }

  /* Monto mínimo automático: que las comisiones de compra y venta no pasen del 1 % anual del
   * monto en el horizonte (redondeado hacia arriba a $100.000), sin pasar de la mitad del
   * presupuesto para que siempre quepan al menos dos inversiones. */
  function autoMin(feeBuy, feeSell, years, budget) {
    const f = (feeBuy || 0) + (feeSell || 0);
    if (!(f > 0)) return 0;
    const m = Math.ceil(f / (0.01 * Math.max(1, years)) / 1e5) * 1e5;
    return budget > 0 ? Math.min(m, Math.floor(budget / 2 / 1e3) * 1e3) : m;
  }

  /* Fracción en el portafolio riesgoso (μ, σ anuales) frente a la renta fija segura rs, en H años,
   * para que P(pérdida) ≤ maxLoss:   H·rs + α·[H(μ − rs) − z σ √H] ≥ 0,  z = Φ⁻¹(1 − maxLoss). */
  function riskyShare(mu, vol, rs, years, maxLoss) {
    if (maxLoss == null || !(maxLoss > 0)) return { alpha: 1, z: null };
    if (mu <= rs) return { alpha: 0, z: null, dominated: true };
    const z = normInv(1 - maxLoss);
    const H = Math.max(years, 1 / 12);
    const coef = H * (mu - rs) - z * vol * Math.sqrt(H);
    if (coef >= 0) return { alpha: 1, z };
    return { alpha: Math.max(0, Math.min(1, (H * rs) / -coef)), z };
  }

  /* Reparte `amount` entre items [{ name, w, price, unit: 'acciones'|'monto', noFee }].
   * Descarta los activos por debajo del monto mínimo o a los que no les alcanza ni una acción. */
  function allocate(items, amount, o) {
    const feeBuy = o.feeBuy || 0;
    const feeSell = o.feeSell == null ? feeBuy : o.feeSell;
    const minAmt = o.minAmt || 0;
    let act = items.filter((x) => x.w > 1e-4 && (x.unit === 'monto' || x.price > 0));
    const dropped = [];
    for (let guard = 0; guard < 80 && act.length; guard++) {
      const fees = act.reduce((s, x) => s + (x.noFee ? 0 : feeBuy), 0);
      const invest = amount - fees;
      const sw = act.reduce((s, x) => s + x.w, 0);
      if (invest <= 0) {
        dropped.push(...dropSmallest(act, 'la comisión no deja monto para invertir'));
        act = act.filter((x) => !dropped.some((d) => d.name === x.name));
        continue;
      }
      // Monto mínimo: primero sale el de menor peso entre los que no lo alcanzan
      const small = act.filter((x) => (x.w / sw) * invest < minAmt - 1e-6);
      if (small.length) {
        const d = small.reduce((m, x) => (x.w < m.w ? x : m), small[0]);
        dropped.push({ name: d.name, why: 'no alcanza el monto mínimo' });
        act = act.filter((x) => x !== d);
        continue;
      }
      const rows = act.map((x) => {
        const target = (x.w / sw) * invest;
        const r = { name: x.name, w: x.w / sw, price: x.price, unit: x.unit, cls: x.cls, target, noFee: !!x.noFee };
        if (x.unit === 'monto') {
          r.amount = Math.floor(target / 1000) * 1000;
          r.shares = null;
        } else r.shares = Math.floor(target / x.price);
        return r;
      });
      let cash = invest - rows.reduce((s, r) => s + (r.unit === 'monto' ? r.amount : r.shares * r.price), 0);
      // Sobrante: una acción más al activo que más lejos está de su objetivo
      for (;;) {
        let best = null;
        let bestDef = 0;
        for (const r of rows) {
          if (r.unit === 'monto') continue;
          const deficit = r.target - r.shares * r.price;
          if (r.price <= cash + 1e-9 && deficit > r.price / 2 && deficit > bestDef) {
            best = r;
            bestDef = deficit;
          }
        }
        if (!best) break;
        best.shares++;
        cash -= best.price;
      }
      const zero = rows.filter((r) => r.unit !== 'monto' && r.shares === 0);
      if (zero.length) {
        zero.forEach((z) => dropped.push({ name: z.name, why: 'no alcanza para una acción' }));
        act = act.filter((x) => !zero.some((z) => z.name === x.name));
        continue;
      }
      rows.forEach((r) => {
        if (r.unit !== 'monto') r.amount = r.shares * r.price;
        r.feeBuy = r.noFee ? 0 : feeBuy;
        r.feeSell = r.noFee ? 0 : feeSell;
      });
      const invested = rows.reduce((s, r) => s + r.amount, 0);
      rows.forEach((r) => (r.realW = r.amount / invested));
      const buyFees = rows.reduce((s, r) => s + r.feeBuy, 0);
      const sellFees = rows.reduce((s, r) => s + r.feeSell, 0);
      return { rows, k: rows.length, invested, buyFees, sellFees, cash: amount - invested - buyFees, dropped };
    }
    return { rows: [], k: 0, invested: 0, buyFees: 0, sellFees: 0, cash: amount, dropped, error: 'El monto no alcanza para ninguna inversión con estas comisiones y este monto mínimo.' };
  }
  function dropSmallest(act, why) {
    const min = act.reduce((m, x) => (x.w < m.w ? x : m), act[0]);
    return [{ name: min.name, why }];
  }

  /* Compatibilidad: acciones enteras con una sola comisión por operación. */
  function integerPlan(items, budget, fee) {
    const r = allocate(items.map((x) => Object.assign({ unit: 'acciones' }, x)), budget, { feeBuy: fee, feeSell: fee });
    return Object.assign(r, { budget, fee });
  }

  /* Valor esperado y riesgo del plan a h años. Renta fija segura a rs; efectivo sin rendimiento;
   * las comisiones de venta se pagan al final. Rango del 95 % con la aproximación normal. */
  function project(plan, e, rs, h) {
    const B = plan.budget;
    const I = plan.invested;
    const S = plan.safe || 0;
    const V = I * Math.pow(1 + e.ret, h) + S * Math.pow(1 + rs, h) + plan.cash - plan.sellFees;
    const sd = (I / B) * e.vol * Math.sqrt(h) * Math.pow(1 + e.ret, h / 2);
    const tot = V / B - 1;
    return {
      years: h,
      value: V,
      gain: V - B,
      total: tot,
      annual: V > 0 ? Math.pow(V / B, 1 / h) - 1 : -1,
      lo: B * (1 + tot - 1.96 * sd),
      hi: B * (1 + tot + 1.96 * sd),
      lossProb: sd > 0 ? normCdf(-tot / sd) : tot < 0 ? 1 : 0,
    };
  }

  /* Medidas del plan en su horizonte, netas de comisiones. */
  function evaluatePlan(m, plan, rs, years) {
    const H = years || 1;
    const w = m.names.map((n) => {
      const r = plan.rows.find((x) => x.name === n);
      return r ? r.realW : 0;
    });
    const e = plan.rows.length ? PF.model.evaluate(m, w) : { ret: 0, vol: 0, w };
    const B = plan.budget;
    const safeRate = rs == null ? m.rf : rs;
    const pj = project(plan, e, safeRate, H);
    const netVol = (e.vol * plan.invested) / B;
    return {
      w,
      e,
      proj: pj,
      grossGain: plan.invested * e.ret,
      netGain: pj.gain / H,
      netRet: pj.annual,
      netVol,
      netSharpe: netVol > 0 ? (pj.annual - m.rf) / netVol : NaN,
      lossProb: pj.lossProb,
      feeShare: (plan.buyFees + plan.sellFees) / B,
      breakEven: plan.invested > 0 ? (plan.buyFees + plan.sellFees) / plan.invested / H : 0,
    };
  }

  /* Plan recomendado.
   *   base: pesos del portafolio elegido; prices: último precio por activo;
   *   opts: { feeBuy, feeSell, years, minAmt, safeRate, maxLoss, units, noFee, optimizeK, solve }
   *   solve(idx) → pesos reoptimizados con esos activos (por defecto, máxima Sharpe). */
  function recommend(m, base, prices, budget, feeOrOpts, opts) {
    const o = Object.assign({ optimizeK: true, hi: 1, years: 1, maxLoss: null }, typeof feeOrOpts === 'object' ? feeOrOpts : Object.assign({ feeBuy: feeOrOpts, feeSell: feeOrOpts }, opts));
    if (o.feeSell == null) o.feeSell = o.feeBuy;
    const rs = o.safeRate == null ? m.rf : o.safeRate;
    const H = o.years || 1;
    const minAmt = o.minAmt == null ? autoMin(o.feeBuy, o.feeSell, H, budget) : o.minAmt;
    const unitOf = (i) => (o.units ? o.units[i] : 'acciones');
    const solve =
      o.solve ||
      ((idx) => {
        const S = idx.map((i) => idx.map((j) => m.Sigma[i][j]));
        const mu = idx.map((i) => m.mu[i]);
        const hi = Math.max(o.hi, 1 / idx.length + 1e-9);
        return Math.max(...mu) > m.rf ? PF.optim.maxRatio(S, mu, m.rf, 0, hi).w : PF.optim.solveQP(S, mu.map(() => 0), 0, hi);
      });
    const usable = (i) => unitOf(i) === 'monto' || prices[i] > 0;
    const order = m.names.map((n, i) => ({ n, i, w: base[i] })).filter((x) => x.w > 1e-4 && usable(x.i)).sort((a, b) => b.w - a.w);

    const make = (idx, w, label) => {
      const full = new Array(m.names.length).fill(0);
      idx.forEach((i, j) => (full[i] = w[j]));
      const eR = PF.model.evaluate(m, full);
      // Reparto con la renta fija segura según el horizonte
      const sh = riskyShare(eR.ret, eR.vol, rs, H, o.maxLoss);
      let riskyAmt = budget * sh.alpha;
      let safe = budget - riskyAmt;
      if (safe > 0 && safe < minAmt) {
        riskyAmt = budget;
        safe = 0;
      }
      if (riskyAmt > 0 && riskyAmt < minAmt) {
        riskyAmt = 0;
        safe = budget;
      }
      const items = idx.map((i, j) => ({ name: m.names[i], w: w[j], price: prices[i], unit: unitOf(i), noFee: o.noFee ? o.noFee[i] : false, cls: o.cls ? o.cls[i] : null }));
      let plan = riskyAmt > 0 ? allocate(items, riskyAmt, { feeBuy: o.feeBuy, feeSell: o.feeSell, minAmt }) : { rows: [], k: 0, invested: 0, buyFees: 0, sellFees: 0, cash: 0, dropped: [] };
      // Si se cayeron activos, reoptimizar con los que quedan
      if (plan.rows.length > 1 && plan.rows.length < idx.length) {
        const idx2 = idx.filter((i) => plan.rows.some((r) => r.name === m.names[i]));
        try {
          const w2 = solve(idx2);
          const items2 = idx2.map((i, j) => ({ name: m.names[i], w: w2[j], price: prices[i], unit: unitOf(i), noFee: o.noFee ? o.noFee[i] : false, cls: o.cls ? o.cls[i] : null }));
          const p2 = allocate(items2, riskyAmt, { feeBuy: o.feeBuy, feeSell: o.feeSell, minAmt });
          if (p2.rows.length === idx2.length) plan = Object.assign(p2, { dropped: plan.dropped });
        } catch (e) {
          /* se queda el reparto proporcional */
        }
      }
      // Lo que no se usa del monto riesgoso (efectivo) pasa a la renta fija si ya hay renta fija
      if (safe > 0 && plan.cash > 0) {
        safe += plan.cash;
        plan.cash = 0;
      }
      Object.assign(plan, { budget, fee: o.feeBuy, feeBuy: o.feeBuy, feeSell: o.feeSell, safe, safeRate: rs, alpha: plan.invested / budget, riskyShare: sh, minAmt, years: H });
      if (!plan.rows.length && !safe) plan.error = plan.error || 'El presupuesto no alcanza para ninguna inversión con estas comisiones y este monto mínimo.';
      const ev = evaluatePlan(m, plan, rs, H);
      return { plan, ev, k: plan.k, label };
    };

    const tries = [];
    const full = make(order.map((x) => x.i), order.map((x) => x.w), 'Portafolio elegido');
    tries.push(full);
    if (o.optimizeK && m.mu) {
      const maxK = minAmt > 0 ? Math.max(1, Math.floor(budget / minAmt)) : order.length;
      for (let k = 1; k < order.length; k++) {
        if (k > maxK + 1) break;
        const idx = order.slice(0, k).map((x) => x.i);
        let w;
        if (k === 1) w = [1];
        else {
          try {
            w = solve(idx);
          } catch (e) {
            continue;
          }
        }
        tries.push(make(idx, w, `${k} ${k === 1 ? 'activo' : 'activos'} de mayor peso`));
      }
    }
    // Menos activos solo si lo que se gana viene de ahorrar comisiones, no de reoptimizar:
    // la mejora de la razón de Sharpe bruta frente al portafolio elegido no cuenta.
    const g0 = Number.isFinite(full.ev.e.sharpe) ? full.ev.e.sharpe : 0;
    const score = (t) => (Number.isFinite(t.ev.netSharpe) ? t.ev.netSharpe - Math.max(0, (t.ev.e.sharpe || 0) - g0) : -1e9 + t.ev.netRet);
    tries.forEach((t) => (t.score = score(t)));
    // Y solo si el ahorro en comisiones pasa de 0,25 % anual del presupuesto: no se sacrifica
    // diversificación por ahorros insignificantes
    const feeCost = (t) => (t.plan.buyFees + t.plan.sellFees) / budget / H;
    tries.forEach((t) => (t.eligible = (t.plan.rows.length > 0 || t.plan.safe > 0) && (t === full || feeCost(full) - feeCost(t) >= 0.0025)));
    const ok = tries.filter((t) => t.eligible);
    ok.sort((a, b) => b.score - a.score);
    const best = ok[0] || full;
    return { best, tries, full, minAmt };
  }

  PF.plan = { autoMin, riskyShare, allocate, integerPlan, project, evaluatePlan, recommend, normInv };
})(typeof globalThis !== 'undefined' ? globalThis : this);
