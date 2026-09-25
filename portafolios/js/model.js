/* Modelo de mercado y medidas de desempeño.
 *   Markowitz (1952): media-varianza y frontera eficiente.
 *   Sharpe (1963, 1966): modelo de índice único y razón de Sharpe.
 *   Treynor (1965): razón de Treynor; Treynor y Black (1973): cartera activa.
 *   Jensen (1968): alfa respecto a la línea del mercado de valores (CAPM). */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const S = PF.stats;
  const O = PF.optim;

  const FREQ = { diaria: 252, semanal: 52, mensual: 12, trimestral: 4, anual: 1 };

  /* datos: { names, returns (por activo, por periodo), market (serie), marketName, dates }
   * ajustes: { freq, rf (anual, decimal), muModel: 'hist'|'capm'|'mix', covModel: 'sample'|'index', marketReturn (anual|null) } */
  function build(datos, ajustes) {
    const f = FREQ[ajustes.freq] || 12;
    const rf = ajustes.rf;
    const rfp = rf / f;
    const n = datos.names.length;
    const T = datos.market.length;
    if (n < 2) throw new Error('Se necesitan al menos dos activos además del índice de mercado.');
    if (T < 6) throw new Error('Hay muy pocos periodos de datos (mínimo 6; recomendable 36 o más).');

    const rm = datos.market;
    const xm = rm.map((r) => r - rfp);
    const mktHist = S.mean(rm) * f;
    const mktVol = Math.sqrt(S.variance(rm) * f);
    const Em = ajustes.marketReturn != null && Number.isFinite(ajustes.marketReturn) ? ajustes.marketReturn : mktHist;

    const assets = datos.returns.map((r, i) => {
      const reg = S.regress(r.map((x) => x - rfp), xm);
      const histRet = S.mean(r) * f;
      const vol = Math.sqrt(S.variance(r) * f);
      return {
        name: datos.names[i],
        histRet,
        histVol: vol,
        beta: reg.beta,
        alphaHist: reg.alpha * f,
        tAlpha: reg.tAlpha,
        pAlpha: S.pValue(reg.tAlpha, T - 2),
        r2: reg.r2,
        residVar: reg.residVar * f,
        capmRet: rf + reg.beta * (Em - rf),
      };
    });

    const mu = assets.map((a) =>
      ajustes.muModel === 'capm' ? a.capmRet : ajustes.muModel === 'mix' ? 0.5 * (a.histRet + a.capmRet) : a.histRet
    );
    let Sigma;
    if (ajustes.covModel === 'index') {
      const vm = mktVol * mktVol;
      Sigma = assets.map((a, i) => assets.map((b, j) => a.beta * b.beta * vm + (i === j ? a.residVar : 0)));
    } else {
      Sigma = S.covMatrix(datos.returns).map((row) => row.map((x) => x * f));
    }
    const vol = Sigma.map((r, i) => Math.sqrt(r[i]));
    assets.forEach((a, i) => {
      a.expRet = mu[i];
      a.vol = vol[i];
      a.sharpe = (mu[i] - rf) / vol[i];
      a.treynor = Math.abs(a.beta) > 1e-9 ? (mu[i] - rf) / a.beta : NaN;
      a.jensen = mu[i] - (rf + a.beta * (Em - rf));
    });

    return {
      names: datos.names,
      marketName: datos.marketName,
      dates: datos.dates,
      returns: datos.returns,
      market: rm,
      f,
      T,
      years: T / f,
      rf,
      rfp,
      mu,
      Sigma,
      vol,
      corr: S.corrFromCov(Sigma),
      assets,
      Em,
      mktHist,
      mktVol,
      mktSharpe: (Em - rf) / mktVol,
      settings: ajustes,
      singular: T <= n,
    };
  }

  /* Todas las medidas de una cartera. */
  function evaluate(m, w) {
    const ret = S.dot(m.mu, w);
    const vol = Math.sqrt(Math.max(0, S.quad(m.Sigma, w)));
    const beta = S.dot(m.assets.map((a) => a.beta), w);
    const sharpe = (ret - m.rf) / vol;
    const treynor = Math.abs(beta) > 1e-9 ? (ret - m.rf) / beta : NaN;
    const jensen = ret - (m.rf + beta * (m.Em - m.rf));
    const m2 = m.rf + sharpe * m.mktVol;
    const hhi = w.reduce((s, x) => s + x * x, 0);
    const effN = 1 / hhi;
    const divRatio = S.dot(m.vol, w.map(Math.abs)) / vol;
    const Sw = S.matVec(m.Sigma, w);
    const riskContrib = w.map((x, i) => (vol > 0 ? (x * Sw[i]) / (vol * vol) : 0));
    // Serie histórica (rebalanceo cada periodo) y regresión de Jensen ex post
    const series = m.market.map((_, t) => w.reduce((s, x, i) => s + x * m.returns[i][t], 0));
    const reg = S.regress(series.map((r) => r - m.rfp), m.market.map((r) => r - m.rfp));
    const histRet = S.mean(series) * m.f;
    // Error típico de la media anual estimada con T periodos
    const seRet = vol / Math.sqrt(m.years);
    return {
      w,
      ret,
      vol,
      beta,
      sharpe,
      treynor,
      jensen,
      m2,
      effN,
      divRatio,
      riskContrib,
      histRet,
      histAlpha: reg.alpha * m.f,
      tAlpha: reg.tAlpha,
      pAlpha: S.pValue(reg.tAlpha, m.T - 2),
      r2: reg.r2,
      ciRet: [ret - 1.96 * seRet, ret + 1.96 * seRet],
      range68: [ret - vol, ret + vol],
      var95: -(ret - 1.645 * vol),
      nHeld: w.filter((x) => Math.abs(x) > 5e-4).length,
    };
  }

  /* Carteras de referencia bajo los límites lo/hi. */
  function portfolios(m, lo, hi) {
    const n = m.mu.length;
    const loA = O.toArr(lo, n);
    const hiA = O.toArr(hi, n);
    const front = O.frontier(m.Sigma, m.mu, loA, hiA);
    const minVar = front[0].w;
    const out = { front, lo: loA, hi: hiA, warnings: [] };
    out.minVar = evaluate(m, minVar);
    if (Math.max(...m.mu) > m.rf) {
      out.tangency = evaluate(m, O.maxRatio(m.Sigma, m.mu, m.rf, loA, hiA, front).w);
    } else {
      out.warnings.push('Ningún activo supera la tasa libre de riesgo: no existe cartera tangente con prima positiva.');
    }
    out.maxDiv = evaluate(m, O.maxRatio(m.Sigma, m.vol, 0, loA, hiA).w);
    const eq = O.projectBoxSimplex(new Array(n).fill(1 / n), loA, hiA);
    out.equal = evaluate(m, eq);
    const rp = O.riskParity(m.Sigma);
    out.riskParity = evaluate(m, rp);
    out.riskParityInBounds = rp.every((x, i) => x >= loA[i] - 1e-9 && x <= hiA[i] + 1e-9);
    out.frontier = front.map((p) => ({ ret: p.ret, vol: p.vol, w: p.w }));
    return out;
  }

  /* Confirmación: ¿la cartera w está sobre la frontera eficiente?
   * Se compara con la frontera cuyos límites incluyen a la propia cartera. */
  function confirm(m, w, lo, hi, tolPP) {
    const n = w.length;
    const sumW = w.reduce((s, x) => s + x, 0);
    const loA = O.toArr(lo, n).map((l, i) => Math.min(l, w[i]));
    const hiA = O.toArr(hi, n).map((h, i) => Math.max(h, w[i]));
    const me = evaluate(m, w);
    const front = O.frontier(m.Sigma, m.mu, loA, hiA);
    const sameRisk = O.frontierAtVol(m.Sigma, m.mu, loA, hiA, front, me.vol);
    const sameRet = O.frontierAtRet(m.Sigma, m.mu, loA, hiA, front, me.ret);
    const retGap = Math.max(0, sameRisk.ret - me.ret);
    const volGap = Math.max(0, me.vol - sameRet.vol);
    const belowMinVar = me.ret < front[0].ret - 1e-9;
    const tol = tolPP != null ? tolPP : 0.001;
    let verdict;
    if (retGap <= tol && !belowMinVar) verdict = 'eficiente';
    else if (retGap <= 5 * tol && !belowMinVar) verdict = 'casi';
    else verdict = 'ineficiente';
    // Tangente dentro de los mismos límites relajados, para la comparación de Sharpe
    const tan = Math.max(...m.mu) > m.rf ? evaluate(m, O.maxRatio(m.Sigma, m.mu, m.rf, loA, hiA, front).w) : null;
    return {
      me,
      sumW,
      verdict,
      retGap,
      volGap,
      belowMinVar,
      sameRisk: evaluate(m, sameRisk.w),
      sameRet: evaluate(m, sameRet.w),
      tangency: tan,
      front: front.map((p) => ({ ret: p.ret, vol: p.vol })),
      bounds: { lo: loA, hi: hiA },
    };
  }

  /* Treynor y Black (1973): combinación óptima del índice (cartera pasiva) con
   * una cartera activa que explota los alfas, ponderados por α / σ²(ε). */
  function treynorBlack(m) {
    const a = m.assets;
    const alpha = a.map((x) => x.jensen);
    const raw = a.map((x, i) => alpha[i] / x.residVar);
    const s = raw.reduce((p, x) => p + x, 0);
    const ir = Math.sqrt(a.reduce((p, x, i) => p + (alpha[i] * alpha[i]) / x.residVar, 0));
    const premium = m.Em - m.rf;
    if (Math.abs(s) < 1e-12 || ir < 1e-9 || premium <= 0) {
      return { ok: false, reason: premium <= 0 ? 'La prima esperada del mercado no es positiva.' : 'Todos los alfas son cero: la cartera óptima es el índice.', ir: ir || 0, sharpeMkt: m.mktSharpe };
    }
    const wA = raw.map((x) => x / s);
    const alphaA = S.dot(wA, alpha);
    const betaA = S.dot(wA, a.map((x) => x.beta));
    const resA = a.reduce((p, x, i) => p + wA[i] * wA[i] * x.residVar, 0);
    const w0 = alphaA / resA / (premium / (m.mktVol * m.mktVol));
    const wStar = w0 / (1 + (1 - betaA) * w0);
    const sharpeP = Math.sqrt(m.mktSharpe * m.mktSharpe + ir * ir);
    const tStats = a.map((x) => x.tAlpha);
    return {
      ok: true,
      wA,
      alphaA,
      betaA,
      resA,
      wActive: wStar,
      wIndex: 1 - wStar,
      assetW: wA.map((x) => x * wStar),
      ir,
      appraisal: a.map((x, i) => alpha[i] / Math.sqrt(x.residVar)),
      sharpeMkt: m.mktSharpe,
      sharpeP,
      significant: tStats.filter((t) => Math.abs(t) >= 2).length,
      shorts: wA.some((x) => x < 0),
    };
  }

  PF.model = { FREQ, build, evaluate, portfolios, confirm, treynorBlack };
})(typeof globalThis !== 'undefined' ? globalThis : this);
