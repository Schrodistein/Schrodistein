/* Gestión del riesgo y backtest.
 *
 * El backtest recorre el histórico vela a vela con el mismo motor de
 * señales que se usa en vivo: la señal se calcula al cierre de la vela i y
 * se ejecuta en la apertura de la i+1. Incluye comisiones, deslizamiento,
 * salida por tiempo y, si en una misma vela se tocan stop y objetivo, da por
 * hecho el stop (criterio conservador). */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});

  /* Tamaño de posición para arriesgar riskPct % del capital, contando las
   * comisiones de entrada y salida dentro de la pérdida máxima. */
  function positionSize(p) {
    const dist = Math.abs(p.entry - p.stop);
    if (!(dist > 0) || !(p.entry > 0) || !(p.capital > 0)) return null;
    const fee = (p.feePct || 0) / 100;
    const riskAmount = (p.capital * p.riskPct) / 100;
    const lossPerUnit = dist + fee * (p.entry + p.stop);
    let qty = riskAmount / lossPerUnit;
    const maxLev = p.maxLeverage || 1;
    let capped = false;
    if (qty * p.entry > p.capital * maxLev) {
      qty = (p.capital * maxLev) / p.entry;
      capped = true;
    }
    if (p.stepSize > 0) qty = Math.floor(qty / p.stepSize + 1e-9) * p.stepSize;
    const notional = qty * p.entry;
    return {
      qty, notional, riskAmount, capped,
      lossAtStop: qty * lossPerUnit,
      gainAtTarget: p.target ? qty * (Math.abs(p.target - p.entry) - fee * (p.entry + p.target)) : null,
      leverage: notional / p.capital,
      stopPct: (dist / p.entry) * 100,
      belowMin: p.minNotional ? notional < p.minNotional : false,
      feeRoundTrip: fee * (p.entry + p.stop) * qty,
    };
  }

  function run(ctx, opts) {
    opts = Object.assign({ capital: 1000, riskPct: 1, feePct: 0.1, slippagePct: 0.02, maxBars: 48, allowShort: false, maxLeverage: 1 }, opts);
    const S = ctx.S;
    const n = S.n;
    const MIN = FX.signals.MIN_BARS;
    const start = n > 400 ? 200 : MIN;
    const fee = opts.feePct / 100;
    const slip = opts.slippagePct / 100;
    let equity = opts.capital;
    let peak = equity;
    let maxDD = 0;
    let feesPaid = 0;
    let barsIn = 0;
    const trades = [];
    const curve = [{ i: start, t: S.t[Math.min(start, n - 1)], equity }];
    let pos = null;
    let pending = null;
    let pendingExit = false;

    const close = (i, price, reason) => {
      const px = price * (1 - pos.dir * slip);
      const fees = fee * pos.qty * (pos.entry + px);
      const pnl = pos.dir * (px - pos.entry) * pos.qty - fees;
      feesPaid += fees;
      equity += pnl;
      trades.push({
        dir: pos.dir, i0: pos.i, t0: S.t[pos.i], entry: pos.entry, stop: pos.stop, target: pos.target,
        i1: i, t1: S.t[i], exit: px, reason, pnl, r: pnl / pos.risk, bars: i - pos.i + 1, score: pos.score,
        retPct: (pnl / (equity - pnl)) * 100,
      });
      peak = Math.max(peak, equity);
      maxDD = Math.max(maxDD, (peak - equity) / peak);
      curve.push({ i, t: S.t[i], equity });
      pos = null;
    };

    for (let i = start; i < n && equity > 0; i++) {
      // 1) Órdenes pendientes, a la apertura de la vela.
      if (pos && pendingExit) close(i, S.o[i], 'Señal contraria');
      pendingExit = false;
      if (!pos && pending) {
        const e = S.o[i] * (1 + pending.dir * slip);
        const dist = Math.abs(pending.entry - pending.stop);
        const stop = e - pending.dir * dist;
        const target = e + pending.dir * pending.rr * dist;
        const ps = positionSize({ capital: equity, riskPct: opts.riskPct, entry: e, stop, feePct: opts.feePct, maxLeverage: opts.allowShort ? opts.maxLeverage : 1 });
        if (ps && ps.qty > 0) pos = { dir: pending.dir, i, entry: e, stop, target, qty: ps.qty, risk: ps.lossAtStop, score: pending.score };
      }
      pending = null;
      // 2) Stop u objetivo dentro de la vela.
      if (pos) {
        barsIn++;
        const o = S.o[i];
        const { dir, stop, target } = pos;
        if (dir > 0) {
          if (o <= stop) close(i, o, 'Stop (hueco)');
          else if (S.l[i] <= stop) close(i, stop, 'Stop');
          else if (o >= target) close(i, o, 'Objetivo');
          else if (S.h[i] >= target) close(i, target, 'Objetivo');
        } else {
          if (o >= stop) close(i, o, 'Stop (hueco)');
          else if (S.h[i] >= stop) close(i, stop, 'Stop');
          else if (o <= target) close(i, o, 'Objetivo');
          else if (S.l[i] <= target) close(i, target, 'Objetivo');
        }
      }
      // 3) Salida por tiempo.
      if (pos && i - pos.i + 1 >= opts.maxBars) close(i, S.c[i], 'Tiempo');
      // 4) Señal al cierre; se ejecutará en la apertura siguiente.
      if (i < n - 1) {
        const s = FX.signals.evaluate(ctx, i, opts);
        if (!pos && s.dir && (s.dir > 0 || opts.allowShort)) pending = s;
        else if (pos && s.dir === -pos.dir) pendingExit = true;
      }
    }
    if (pos) close(n - 1, S.c[n - 1], 'Fin de los datos');
    return { trades, curve, stats: summarize(trades, opts, { equity, maxDD, feesPaid, barsIn, start, n, S }) };
  }

  function summarize(trades, opts, x) {
    const N = trades.length;
    const wins = trades.filter((t) => t.pnl > 0);
    const gw = wins.reduce((s, t) => s + t.pnl, 0);
    const gl = -trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
    const rs = trades.map((t) => t.r);
    const mR = N ? rs.reduce((s, v) => s + v, 0) / N : NaN;
    const sdR = N > 1 ? Math.sqrt(rs.reduce((s, v) => s + (v - mR) ** 2, 0) / (N - 1)) : NaN;
    let streak = 0;
    let maxStreak = 0;
    for (const t of trades) {
      streak = t.pnl <= 0 ? streak + 1 : 0;
      maxStreak = Math.max(maxStreak, streak);
    }
    const { S, start, n } = x;
    const s0 = Math.min(start, n - 1);
    return {
      trades: N,
      longs: trades.filter((t) => t.dir > 0).length,
      shorts: trades.filter((t) => t.dir < 0).length,
      winRate: N ? wins.length / N : NaN,
      breakevenWinRate: 1 / (1 + (opts.rr || 2)),
      profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : NaN,
      expectancyR: mR,
      // Intervalo de confianza del 95 % de la esperanza por operación (en R).
      expectancyCI: N > 1 ? [mR - (1.96 * sdR) / Math.sqrt(N), mR + (1.96 * sdR) / Math.sqrt(N)] : [NaN, NaN],
      netPct: (x.equity / opts.capital - 1) * 100,
      finalEquity: x.equity,
      maxDDPct: x.maxDD * 100,
      buyHoldPct: (S.c[n - 1] / S.o[s0] - 1) * 100,
      feesPaid: x.feesPaid,
      avgBars: N ? trades.reduce((s, t) => s + t.bars, 0) / N : NaN,
      exposure: x.barsIn / Math.max(1, n - s0),
      maxLosingStreak: maxStreak,
      from: S.t[s0],
      to: S.t[n - 1],
      bars: n - s0,
    };
  }

  FX.risk = { positionSize };
  FX.backtest = { run, summarize };
})(typeof globalThis !== 'undefined' ? globalThis : this);
