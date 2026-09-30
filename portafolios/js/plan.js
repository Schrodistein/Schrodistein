/* Plan de compra: acciones enteras para un presupuesto, con comisión fija por
 * operación (en trii, unos $15.000 por cada compra y cada venta).
 *
 * La comisión es un costo fijo por activo, así que con presupuestos pequeños
 * conviene tener menos activos: el plan prueba quedarse con los k activos de
 * mayor peso (k = 1…n), reoptimiza el portafolio tangente con esos k y elige el
 * k con mejor razón de Sharpe neta de comisiones. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});

  /* Acciones enteras lo más cerca posible de los pesos objetivo.
   * items: [{ name, w, price }]; se descartan los activos a los que no alcanza
   * para comprar ni una acción, y se recalcula con menos comisiones. */
  function integerPlan(items, budget, fee) {
    let act = items.filter((x) => x.w > 1e-4 && x.price > 0);
    for (let guard = 0; guard < 50 && act.length; guard++) {
      const k = act.length;
      const invest = budget - k * fee;
      if (invest <= 0) {
        act = dropSmallest(act);
        continue;
      }
      const sw = act.reduce((s, x) => s + x.w, 0);
      const rows = act.map((x) => {
        const target = (x.w / sw) * invest;
        return { name: x.name, w: x.w / sw, price: x.price, target, shares: Math.floor(target / x.price) };
      });
      let cash = invest - rows.reduce((s, r) => s + r.shares * r.price, 0);
      // Repartir el sobrante: una acción más al activo que más lejos está de su objetivo
      for (;;) {
        let best = null;
        for (const r of rows) {
          const deficit = r.target - r.shares * r.price;
          if (r.price <= cash + 1e-9 && deficit > r.price / 2 && (!best || deficit > best.target - best.shares * best.price)) best = r;
        }
        if (!best) break;
        best.shares++;
        cash -= best.price;
      }
      const zero = rows.filter((r) => r.shares === 0);
      if (zero.length) {
        act = act.filter((x) => !zero.some((z) => z.name === x.name));
        continue;
      }
      const invested = rows.reduce((s, r) => s + r.shares * r.price, 0);
      rows.forEach((r) => {
        r.amount = r.shares * r.price;
        r.realW = r.amount / invested;
      });
      return { rows, k, invested, buyFees: k * fee, sellFees: k * fee, cash: budget - invested - k * fee, budget, fee };
    }
    return { rows: [], k: 0, invested: 0, buyFees: 0, sellFees: 0, cash: budget, budget, fee, error: 'El presupuesto no alcanza para comprar ni una acción después de la comisión.' };
  }
  function dropSmallest(act) {
    const min = act.reduce((m, x) => (x.w < m.w ? x : m), act[0]);
    return act.filter((x) => x !== min);
  }

  /* Rendimiento y riesgo del plan con los pesos reales, netos de comisiones de compra
   * y de venta (se asume vender al cabo de un año). El efectivo sobrante no rinde. */
  function evaluatePlan(m, plan) {
    if (!plan.rows.length) return null;
    const w = m.names.map((n) => {
      const r = plan.rows.find((x) => x.name === n);
      return r ? r.realW : 0;
    });
    const e = PF.model.evaluate(m, w);
    const B = plan.budget;
    const gross = plan.invested * e.ret;
    const net = gross - plan.buyFees - plan.sellFees;
    const netRet = net / B;
    const netVol = (e.vol * plan.invested) / B;
    return {
      w,
      e,
      grossGain: gross,
      netGain: net,
      netRet,
      netVol,
      netSharpe: netVol > 0 ? (netRet - m.rf) / netVol : NaN,
      feeShare: (plan.buyFees + plan.sellFees) / B,
      breakEven: (plan.buyFees + plan.sellFees) / plan.invested,
    };
  }

  /* Plan recomendado. base: pesos del portafolio elegido; prices: último cierre por activo.
   * optimizeK: probar con menos activos y reoptimizar el tangente en cada subconjunto. */
  function recommend(m, base, prices, budget, fee, opts) {
    const o = Object.assign({ optimizeK: true, lo: 0, hi: 1 }, opts);
    const order = m.names.map((n, i) => ({ n, i, w: base[i] })).filter((x) => x.w > 1e-4 && prices[x.i] > 0).sort((a, b) => b.w - a.w);
    const tries = [];
    const make = (idx, w) => {
      const plan = integerPlan(idx.map((i, j) => ({ name: m.names[i], w: w[j], price: prices[i] })), budget, fee);
      const ev = evaluatePlan(m, plan);
      return { plan, ev };
    };
    // El portafolio base tal cual
    const full = make(order.map((x) => x.i), order.map((x) => x.w));
    full.k = full.plan.k;
    full.label = 'Portafolio elegido';
    tries.push(full);
    if (o.optimizeK && m.mu) {
      for (let k = 1; k < order.length; k++) {
        const idx = order.slice(0, k).map((x) => x.i);
        let w;
        if (k === 1) w = [1];
        else {
          const S = idx.map((i) => idx.map((j) => m.Sigma[i][j]));
          const mu = idx.map((i) => m.mu[i]);
          const hi = Math.max(o.hi, 1 / k + 1e-9);
          try {
            w = Math.max(...mu) > m.rf ? PF.optim.maxRatio(S, mu, m.rf, 0, hi).w : PF.optim.solveQP(S, mu.map(() => 0), 0, hi);
          } catch (e) {
            continue;
          }
        }
        const t = make(idx, w);
        t.k = t.plan.k;
        t.label = `${k} ${k === 1 ? 'activo' : 'activos'} de mayor peso`;
        tries.push(t);
      }
    }
    const ok = tries.filter((t) => t.ev && Number.isFinite(t.ev.netSharpe));
    ok.sort((a, b) => b.ev.netSharpe - a.ev.netSharpe);
    const best = ok[0] || full;
    return { best, tries, full };
  }

  PF.plan = { integerPlan, evaluatePlan, recommend };
})(typeof globalThis !== 'undefined' ? globalThis : this);
