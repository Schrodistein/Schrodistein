/* Libro de Excel con todos los cálculos del análisis, hechos con fórmulas de Excel
 * que remiten a sus celdas de origen, para seguir el desarrollo de cada número:
 *   Resumen · Precios · Rendimientos · Estadisticas · Desviaciones · Covarianza ·
 *   Correlacion · Portafolios · Frontera · Plan_compra · Formulas
 * Las fórmulas se escriben con nombres de función en inglés (así las guarda Excel)
 * y Excel las muestra traducidas al abrir el archivo. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const X = () => PF.xlsx;
  const fin = Number.isFinite;

  const FREQ_TXT = { diaria: 'Diaria', semanal: 'Semanal', mensual: 'Mensual', trimestral: 'Trimestral', anual: 'Anual' };
  const MU_TXT = { hist: 'Media histórica', capm: 'CAPM: rf + β(E(Rm) − rf)', mix: '50 % media histórica + 50 % CAPM' };

  /* ctx: { m, P, table:{names,dates,values}, marketIdx, s:{freq,retType,agg,history,muModel,covModel,wmin,wmax,capital},
   *        extra:[{label, w}] (portafolios adicionales: el del usuario, el del plan), plan, generated } */
  const REFS = [
    'Blume, M. E. (1975). Betas and their regression tendencies. Journal of Finance, 30(3), 785-795.',
    'Choueifaty, Y. y Coignard, Y. (2008). Toward maximum diversification. Journal of Portfolio Management, 35(1), 40-51.',
    'Damodaran, A. (2012). Investment valuation (3.ª ed.). Wiley.',
    'Elton, E. J. y Gruber, M. J. (1977). Risk reduction and portfolio size: An analytical solution. Journal of Business, 50(4), 415-437.',
    'Hamada, R. S. (1972). The effect of the firm\'s capital structure on the systematic risk of common stocks. Journal of Finance, 27(2), 435-452.',
    'Jensen, M. C. (1968). The performance of mutual funds in the period 1945-1964. Journal of Finance, 23(2), 389-416.',
    'Lintner, J. (1965). The valuation of risk assets and the selection of risky investments in stock portfolios and capital budgets. Review of Economics and Statistics, 47(1), 13-37.',
    'Markowitz, H. (1952). Portfolio selection. Journal of Finance, 7(1), 77-91.',
    'Pearson, K. (1896). Mathematical contributions to the theory of evolution. III. Regression, heredity, and panmixia. Philosophical Transactions of the Royal Society A, 187, 253-318.',
    'Roy, A. D. (1952). Safety first and the holding of assets. Econometrica, 20(3), 431-449.',
    'Sharpe, W. F. (1963). A simplified model for portfolio analysis. Management Science, 9(2), 277-293.',
    'Sharpe, W. F. (1964). Capital asset prices: A theory of market equilibrium under conditions of risk. Journal of Finance, 19(3), 425-442.',
    'Sharpe, W. F. (1966). Mutual fund performance. Journal of Business, 39(1), 119-138.',
    'Tobin, J. (1958). Liquidity preference as behavior towards risk. Review of Economic Studies, 25(2), 65-86.',
    'Treynor, J. L. (1965). How to rate management of investment funds. Harvard Business Review, 43(1), 63-75.',
    'Treynor, J. L. y Black, F. (1973). How to use security analysis to improve portfolio selection. Journal of Business, 46(1), 66-86.',
  ];

  function build(ctx) {
    const { m, P, table } = ctx;
    const s = ctx.s;
    const col = X().colName;
    const logRet = s.retType !== 'simple';
    const f = m.f;
    // Orden de columnas: mercado primero, luego los activos en el orden del modelo y al final
    // los índices de referencia de otros segmentos (COLTES, COLIBR, TRM…), si los hay
    const benchNames = [...new Set(m.assets.map((a) => a.bench).filter((b) => b && b !== m.marketName && table.names.includes(b)))];
    const order = [ctx.marketIdx].concat(m.names.map((n) => table.names.indexOf(n)), benchNames.map((b) => table.names.indexOf(b)));
    const labels = order.map((k, j) => (j > m.names.length ? `${table.names[k]} (índice de referencia)` : table.names[k]));
    const N = m.names.length;
    const NS = N + 1; // series con estadísticas (mercado + activos)
    const NP = order.length; // columnas de precios y rendimientos (con los índices de referencia)
    const T = table.dates.length;
    const price = order.map((k) => table.values[k]);
    const common = s.history === 'common';
    const rowOk = (t) => price.slice(0, NS).every((p) => fin(p[t]));
    const ret = price.map((p) =>
      p.map((v, t) => {
        if (t === 0 || !fin(v) || !fin(p[t - 1])) return NaN;
        if (common && !(rowOk(t) && rowOk(t - 1))) return NaN;
        return logRet ? Math.log(v / p[t - 1]) : v / p[t - 1] - 1;
      })
    );
    const C = (j) => col(j + 1); // columna de la serie j en Precios/Rendimientos (A = fecha)
    const R1 = 3;
    const R2 = T + 1;
    const range = (j) => `Rendimientos!$${C(j)}$${R1}:$${C(j)}$${R2}`;
    const meanOf = (a) => {
      const v = a.filter(fin);
      return v.reduce((q, x) => q + x, 0) / v.length;
    };

    /* ---------- Precios ---------- */
    const precios = [['Fecha'].concat(labels).map((x) => ({ v: x, s: 'h' }))];
    for (let t = 0; t < T; t++) precios.push([table.dates[t]].concat(price.map((p) => (fin(p[t]) ? p[t] : null))));

    /* ---------- Rendimientos ---------- */
    const rend = [['Fecha'].concat(labels.map((l) => `r ${l}`)).map((x) => ({ v: x, s: 'h' })), [table.dates[0]]];
    const lastCol = C(NS - 1);
    for (let t = 1; t < T; t++) {
      const n = t + 1; // Precios: la fila t está en n + 1 y la anterior en n
      const row = [table.dates[t]];
      for (let j = 0; j < NP; j++) {
        const a = `Precios!${C(j)}${n + 1}`;
        const b = `Precios!${C(j)}${n}`;
        const core = logRet ? `LN(${a}/${b})` : `${a}/${b}-1`;
        const cond = common ? `COUNT(Precios!$B${n + 1}:$${lastCol}${n + 1},Precios!$B${n}:$${lastCol}${n})=${2 * NS}` : `AND(ISNUMBER(${a}),ISNUMBER(${b}))`;
        const v = ret[j][t];
        row.push({ f: `IF(${cond},${core},"")`, v: fin(v) ? v : '', s: 'num6' });
      }
      rend.push(row);
    }

    /* ---------- Estadisticas ---------- */
    const E = []; // filas
    E.push([{ v: 'Estadísticas por activo', s: 't' }]);
    E.push([{ v: `Rendimientos ${logRet ? 'logarítmicos' : 'simples'} por periodo (${(FREQ_TXT[s.freq] || s.freq).toLowerCase()}), anualizados con f periodos por año. Los cálculos por periodo usan las celdas de la hoja Rendimientos.`, s: 'n' }]);
    E.push([]);
    E.push([{ v: 'Parámetros', s: 'b' }]);
    E.push(['Tasa libre de riesgo anual (rf)', { v: m.rf, s: 'pct' }]); // B5
    E.push(['Periodos por año (f)', f]); // B6
    E.push(['rf por periodo = rf / f', { f: 'B5/B6', v: m.rfp, s: 'num6' }]); // B7
    const emFormula = s.marketReturnSet ? null : `${C(0)}17`;
    E.push(['Rendimiento esperado del mercado E(Rm)', emFormula ? { f: emFormula, v: m.Em, s: 'pct' } : { v: m.Em, s: 'pct' }]); // B8
    E.push(['Modelo de rendimiento esperado', MU_TXT[s.muModel] || s.muModel]); // B9
    E.push(['Covarianzas', s.covModel === 'index' ? 'Modelo de índice único de Sharpe' : common ? 'Muestrales, solo periodos comunes' : 'Muestrales, por pares (cada activo con toda su historia)']);
    E.push([]);
    // Encabezado (fila 12) y medidas desde la fila 13
    E.push([{ v: 'Medida', s: 'h' }].concat(labels.map((l, j) => ({ v: j === 0 ? `${l} (mercado)` : l, s: 'h' })), [{ v: 'Fórmula (columna del primer activo)', s: 'h' }, { v: 'Qué es', s: 'h' }]));
    const statRow = {};
    const assetAt = (j) => m.assets[j - 1];
    const Rm = range(0);
    // Rango de rendimientos del índice de referencia del activo j (el principal si no tiene otro)
    const benchJ = (j) => (j === 0 ? -1 : benchNames.indexOf(assetAt(j).bench));
    const Rb = (j) => (benchJ(j) >= 0 ? range(NS + benchJ(j)) : Rm);
    const ownBench = (j) => benchJ(j) >= 0;
    const cell = (key, j) => `Estadisticas!$${C(j)}$${statRow[key]}`;
    const local = (key, j) => `${C(j)}${statRow[key]}`;
    const measures = [
      ['obs', 'Observaciones (n)', 'int', (j) => `COUNT(${range(j)})`, (j) => ret[j].filter(fin).length, 'Número de rendimientos con dato'],
      ['mean', 'Media por periodo', 'num6', (j) => `AVERAGE(${range(j)})`, (j) => meanOf(ret[j]), 'Promedio de los rendimientos'],
      ['hist', 'Rendimiento histórico anual', 'pct', (j) => `${local('mean', j)}*$B$6`, (j) => meanOf(ret[j]) * f, 'Media × f'],
      ['var', 'Varianza por periodo', 'num6', (j) => `_xlfn.VAR.S(${range(j)})`, (j) => PF.stats.variance(ret[j].filter(fin)), 'Σ(r − media)² / (n − 1)'],
      ['sd', 'Desviación estándar por periodo', 'num6', (j) => `_xlfn.STDEV.S(${range(j)})`, (j) => Math.sqrt(PF.stats.variance(ret[j].filter(fin))), '√varianza'],
      ['volh', 'Volatilidad histórica anual', 'pct', (j) => `${local('sd', j)}*SQRT($B$6)`, (j) => Math.sqrt(PF.stats.variance(ret[j].filter(fin)) * f), 'Desviación × √f'],
      ['bench', 'Índice de referencia del segmento', 'n', () => null, (j) => (j === 0 ? m.marketName : assetAt(j).bench), 'Renta variable: el índice principal; renta fija: COLTES o COLIBR; divisas: TRM; derivados: el índice del subyacente'],
      ['eb', 'E(R) del índice de referencia', 'pct', (j) => (j === 0 || !ownBench(j) ? '$B$8' : `AVERAGE(${Rb(j)})*$B$6`), (j) => (j === 0 ? m.Em : assetAt(j).benchRet), 'E(Rm) del índice principal, o la media histórica anual del índice del segmento'],
      ['beta', 'Beta β (frente a su índice)', 'num4', (j) => (j === 0 ? '1' : `SLOPE(${range(j)},${Rb(j)})`), (j) => (j === 0 ? 1 : assetAt(j).beta), 'Pendiente de la regresión de r del activo sobre r de su índice = Cov(rᵢ, rb) / Var(rb)'],
      ['r2', 'R² con su índice', 'num4', (j) => (j === 0 ? '1' : `RSQ(${range(j)},${Rb(j)})`), (j) => (j === 0 ? 1 : assetAt(j).r2), 'Parte del riesgo explicada por el índice (riesgo sistemático)'],
      ['alphah', 'Alfa histórico anual (regresión)', 'pct', (j) => (j === 0 ? '0' : `(INTERCEPT(${range(j)},${Rb(j)})-$B$7*(1-${local('beta', j)}))*$B$6`), (j) => (j === 0 ? 0 : assetAt(j).alphaHist), 'Ordenada de la regresión del exceso de rendimiento (r − rf) sobre el del índice, × f'],
      ['resid', 'Varianza residual anual σ²(ε)', 'num6', (j) => (j === 0 ? '0' : `STEYX(${range(j)},${Rb(j)})^2*$B$6`), (j) => (j === 0 ? 0 : assetAt(j).residVar), 'Riesgo no sistemático: error típico de la regresión al cuadrado × f'],
      ['betaM', 'Beta frente al índice principal βM', 'num4', (j) => (j === 0 ? '1' : ownBench(j) ? `SLOPE(${range(j)},${Rm})` : local('beta', j)), (j) => (j === 0 ? 1 : assetAt(j).betaM), 'Para la β del portafolio y el modelo de índice único'],
      ['residM', 'σ²(ε) frente al índice principal', 'num6', (j) => (j === 0 ? '0' : ownBench(j) ? `STEYX(${range(j)},${Rm})^2*$B$6` : local('resid', j)), (j) => (j === 0 ? 0 : assetAt(j).residVarM), 'Riesgo no sistemático frente al índice principal'],
      ['capm', 'Rendimiento CAPM', 'pct', (j) => `$B$5+${local('beta', j)}*(${local('eb', j)}-$B$5)`, (j) => (j === 0 ? m.Em : assetAt(j).capmRet), 'rf + β (E(Rb) − rf)'],
      [
        'exp',
        'Rendimiento esperado usado E(R)',
        'pct',
        (j) => (j === 0 ? '$B$8' : s.muModel === 'capm' ? local('capm', j) : s.muModel === 'mix' ? `0.5*${local('hist', j)}+0.5*${local('capm', j)}` : local('hist', j)),
        (j) => (j === 0 ? m.Em : m.mu[j - 1]),
        'Según el modelo elegido (ver parámetros)',
      ],
      ['vol', 'Volatilidad usada σ (de la matriz de covarianzas)', 'pct', (j) => (j === 0 ? local('volh', j) : `SQRT(INDEX(Covarianza!$B$${COV0 + 1}:$${col(N)}$${COV0 + N},${j},${j}))`), (j) => (j === 0 ? m.mktVol : m.vol[j - 1]), 'Raíz de la diagonal de la matriz de covarianzas anual'],
      ['sharpe', 'Razón de Sharpe', 'num4', (j) => `(${local('exp', j)}-$B$5)/${local('vol', j)}`, (j) => (j === 0 ? m.mktSharpe : assetAt(j).sharpe), '(E(R) − rf) / σ'],
      ['treynor', 'Razón de Treynor', 'pct', (j) => `(${local('exp', j)}-$B$5)/${local('beta', j)}`, (j) => (j === 0 ? m.Em - m.rf : assetAt(j).treynor), '(E(R) − rf) / β'],
      ['jensen', 'Alfa de Jensen', 'pct', (j) => `${local('exp', j)}-($B$5+${local('beta', j)}*(${local('eb', j)}-$B$5))`, (j) => (j === 0 ? 0 : assetAt(j).jensen), 'E(R) − [rf + β (E(Rb) − rf)]'],
    ];
    const COV0 = 5; // fila (1-based) del encabezado de la matriz anual en la hoja Covarianza
    measures.forEach((ms, k) => (statRow[ms[0]] = 13 + k));
    // la fila de «hist» del mercado alimenta E(Rm) (B8) cuando no se fijó a mano
    if (emFormula) E[7][1] = { f: `${C(0)}${statRow.hist}`, v: m.Em, s: 'pct' };
    for (const [key, label, sty, fx, vx, expl] of measures) {
      const row = [label];
      for (let j = 0; j < NS; j++) row.push(fx(j) == null ? { v: vx(j), s: sty } : { f: fx(j), v: vx(j), s: sty });
      row.push({ v: fx(Math.min(1, NS - 1)) == null ? '' : '=' + fx(Math.min(1, NS - 1)).replace(/\$/g, ''), s: 'n' }, { v: expl, s: 'n' });
      E.push(row);
      void key;
    }

    /* ---------- Desviaciones ---------- */
    const pairs = [];
    const allPairs = NS <= 12;
    for (let a = 0; a < NS; a++) for (let b = a + 1; b < NS; b++) if (allPairs || a === 0) pairs.push([a, b]);
    const D = [];
    const devCol = (j) => col(1 + j);
    const sqCol = (j) => col(1 + NS + j);
    const prCol = (k) => col(1 + 2 * NS + k);
    D.push(['Fecha'].concat(labels.map((l) => `r − media ${l}`), labels.map((l) => `(r − media)² ${l}`), pairs.map(([a, b]) => `${labels[a]} × ${labels[b]}`)).map((x) => ({ v: x, s: 'h' })));
    D.push([table.dates[0]]);
    const means = ret.map(meanOf);
    for (let t = 1; t < T; t++) {
      const n = t + 2; // fila de Excel (igual en Rendimientos y Desviaciones)
      const row = [table.dates[t]];
      for (let j = 0; j < NS; j++) {
        const v = ret[j][t];
        row.push({ f: `IF(ISNUMBER(Rendimientos!${C(j)}${n}),Rendimientos!${C(j)}${n}-${cell('mean', j)},"")`, v: fin(v) ? v - means[j] : '', s: 'num6' });
      }
      for (let j = 0; j < NS; j++) {
        const v = ret[j][t];
        row.push({ f: `IF(ISNUMBER(${devCol(j)}${n}),${devCol(j)}${n}^2,"")`, v: fin(v) ? (v - means[j]) ** 2 : '', s: 'num6' });
      }
      pairs.forEach(([a, b]) => {
        const va = ret[a][t];
        const vb = ret[b][t];
        row.push({ f: `IF(AND(ISNUMBER(${devCol(a)}${n}),ISNUMBER(${devCol(b)}${n})),${devCol(a)}${n}*${devCol(b)}${n},"")`, v: fin(va) && fin(vb) ? (va - means[a]) * (vb - means[b]) : '', s: 'num6' });
      });
      D.push(row);
    }
    const foot = T + 2; // fila en blanco y luego los totales
    D.push([]);
    const sums = ['Suma Σ'];
    const cnts = ['n (datos)'];
    const vars = ['Σ / (n − 1): varianza o covarianza por periodo'];
    const anns = ['× f: anual'];
    const totalCols = 2 * NS + pairs.length;
    for (let c = 1; c <= totalCols; c++) {
      const L = col(c);
      const values = D.slice(2).map((r) => r[c]).filter((x) => x && fin(x.v)).map((x) => x.v);
      const sum = values.reduce((q, x) => q + x, 0);
      sums.push({ f: `SUM(${L}3:${L}${T + 1})`, v: sum, s: 'num6' });
      cnts.push({ f: `COUNT(${L}3:${L}${T + 1})`, v: values.length, s: 'int' });
      if (c > NS) {
        vars.push({ f: `${L}${foot + 1}/(${L}${foot + 2}-1)`, v: sum / (values.length - 1), s: 'num6' });
        anns.push({ f: `${L}${foot + 3}*Estadisticas!$B$6`, v: (sum / (values.length - 1)) * f, s: 'num6' });
      } else {
        vars.push(null);
        anns.push(null);
      }
    }
    D.push(sums, cnts, vars, anns);
    D.push([]);
    D.push([{ v: 'Las columnas (r − media)² llevan a la varianza de cada serie y los productos cruzados a la covarianza de cada par. Cada serie usa su propia media; si dos series no tienen las mismas fechas, la covarianza de un par puede diferir un poco de COVARIANZA.M, que usa la media de las fechas compartidas.', s: 'n' }]);

    /* ---------- Covarianza ---------- */
    const Cv = [];
    Cv.push([{ v: 'Matriz de varianzas y covarianzas', s: 't' }]);
    const covTxt =
      s.covModel === 'index'
        ? 'Modelo de índice único de Sharpe: σᵢⱼ = βᵢ βⱼ σm² (+ σ²(εᵢ) en la diagonal).'
        : common
          ? 'Covarianza muestral de los periodos comunes, anualizada: COVARIANZA.M(rᵢ, rⱼ) × f.'
          : 'Covarianza por pares: σᵢⱼ = ρᵢⱼ σᵢ σⱼ, con ρ de la hoja Correlacion (fechas que comparten los dos activos) y σ anual de la hoja Estadisticas.';
    Cv.push([{ v: covTxt, s: 'n' }]);
    Cv.push([]);
    Cv.push([{ v: 'Anual, usada para los portafolios', s: 'b' }]);
    // fila COV0 (1-based = 5): encabezado
    Cv.push([{ v: '', s: 'h' }].concat(m.names.map((n) => ({ v: n, s: 'h' }))));
    const corrCell = (a, b) => `Correlacion!$${col(1 + a)}$${4 + b}`; // series a,b (0 = mercado)
    for (let i = 0; i < N; i++) {
      const row = [{ v: m.names[i], s: 'b' }];
      for (let j = 0; j < N; j++) {
        let fx;
        if (s.covModel === 'index') fx = `${cell('betaM', i + 1)}*${cell('betaM', j + 1)}*${cell('volh', 0)}^2${i === j ? `+${cell('residM', i + 1)}` : ''}`;
        else if (common) fx = `_xlfn.COVARIANCE.S(${range(i + 1)},${range(j + 1)})*Estadisticas!$B$6`;
        else fx = `${corrCell(i + 1, j + 1)}*${cell('volh', i + 1)}*${cell('volh', j + 1)}`;
        row.push(m.info.psdFixed ? { v: m.Sigma[i][j], s: 'num6' } : { f: fx, v: m.Sigma[i][j], s: 'num6' });
      }
      Cv.push(row);
    }
    if (m.info.psdFixed) {
      Cv.push([]);
      Cv.push([{ v: 'La matriz por pares no era válida (tenía valores propios negativos) y la app la ajustó a la matriz válida más cercana. Arriba están los valores ajustados que se usaron; abajo, la fórmula sin ajustar.', s: 'n' }]);
      Cv.push([{ v: '', s: 'h' }].concat(m.names.map((n) => ({ v: n, s: 'h' }))));
      for (let i = 0; i < N; i++) {
        const row = [{ v: m.names[i], s: 'b' }];
        for (let j = 0; j < N; j++) row.push({ f: `${corrCell(i + 1, j + 1)}*${cell('volh', i + 1)}*${cell('volh', j + 1)}`, s: 'num6' });
        Cv.push(row);
      }
    }
    Cv.push([]);
    Cv.push([{ v: 'Por periodo, sin anualizar: COVARIANZA.M(rᵢ, rⱼ) con las fechas que comparten', s: 'b' }]);
    Cv.push([{ v: '', s: 'h' }].concat(labels.map((n) => ({ v: n, s: 'h' }))));
    for (let a = 0; a < NS; a++) {
      const row = [{ v: labels[a], s: 'b' }];
      for (let b = 0; b < NS; b++) {
        const [x, y] = pairOf(ret[a], ret[b]);
        row.push({ f: `_xlfn.COVARIANCE.S(${range(a)},${range(b)})`, v: x.length > 1 ? PF.stats.covariance(x, y) : '', s: 'num6' });
      }
      Cv.push(row);
    }

    /* ---------- Correlacion ---------- */
    const Co = [];
    Co.push([{ v: 'Matriz de correlación', s: 't' }]);
    Co.push([{ v: 'ρᵢⱼ = Cov(rᵢ, rⱼ) / (σᵢ σⱼ), con las fechas que comparten los dos activos: COEF.DE.CORREL(rᵢ, rⱼ).', s: 'n' }]);
    Co.push([{ v: '', s: 'h' }].concat(labels.map((n) => ({ v: n, s: 'h' }))));
    for (let a = 0; a < NS; a++) {
      const row = [{ v: labels[a], s: 'b' }];
      for (let b = 0; b < NS; b++) {
        const [x, y] = pairOf(ret[a], ret[b]);
        const v = a === b ? 1 : x.length > 2 ? PF.stats.covariance(x, y) / Math.sqrt(PF.stats.variance(x) * PF.stats.variance(y)) : '';
        row.push({ f: `CORREL(${range(a)},${range(b)})`, v, s: 'num4' });
      }
      Co.push(row);
    }

    /* ---------- Portafolios ---------- */
    const Pt = [];
    Pt.push([{ v: 'Portafolios: pesos y cálculo de cada medida', s: 't' }]);
    Pt.push([{ v: 'Los pesos salen del optimizador de la app (programación cuadrática; en Excel se pueden verificar con Solver). Todo lo demás son fórmulas sobre las hojas Estadisticas y Covarianza.', s: 'n' }]);
    Pt.push([]);
    const estRange = (key) => `Estadisticas!$${C(1)}$${statRow[key]}:$${C(N)}$${statRow[key]}`;
    const covRow = (i) => `Covarianza!$B$${COV0 + 1 + i}:$${col(N)}$${COV0 + 1 + i}`;
    const blocks = [
      ['Recomendado: máximo rendimiento eficiente con diversificación mínima', P.recommended],
      ['Máxima razón de Sharpe (tangente)', P.tangency],
      ['Mínima varianza', P.minVar],
      ['Máxima diversificación', P.maxDiv],
      ['Paridad de riesgo', P.riskParity],
      ['Pesos iguales (1/N)', P.equal],
    ]
      .filter((b) => b[1])
      .map(([label, e]) => ({ label, w: e.w }))
      .concat(ctx.extra || []);
    const summaryRows = [];
    for (const blk of blocks) {
      const e = PF.model.evaluate(m, blk.w);
      const top = Pt.length + 1; // fila de Excel del título del bloque
      Pt.push([{ v: blk.label, s: 'b' }]);
      Pt.push([{ v: '', s: 'h' }].concat(m.names.map((n) => ({ v: n, s: 'h' })), [{ v: 'Fórmula', s: 'h' }]));
      const rw = top + 2; // fila de pesos
      const rSw = top + 6;
      const rVar = top + 9;
      const wR = `$B$${rw}:$${col(N)}$${rw}`;
      Pt.push(['Peso wᵢ'].concat(blk.w.map((x) => ({ v: x, s: 'pct' }))));
      Pt.push(['E(Rᵢ)'].concat(m.names.map((_, i) => ({ f: cell('exp', i + 1), v: m.mu[i], s: 'pct' }))));
      Pt.push(['βᵢ (frente al índice principal)'].concat(m.names.map((_, i) => ({ f: cell('betaM', i + 1), v: m.assets[i].betaM, s: 'num4' }))));
      Pt.push(['σᵢ'].concat(m.names.map((_, i) => ({ f: cell('vol', i + 1), v: m.vol[i], s: 'pct' }))));
      const Sw = PF.stats.matVec(m.Sigma, blk.w);
      Pt.push(['(Σw)ᵢ = Σⱼ σᵢⱼ wⱼ'].concat(m.names.map((_, i) => ({ f: `SUMPRODUCT(${covRow(i)},${wR})`, v: Sw[i], s: 'num6' })), [{ v: '=SUMAPRODUCTO(fila i de la matriz; pesos)', s: 'n' }]));
      Pt.push(['Contribución al riesgo wᵢ(Σw)ᵢ / σp²'].concat(m.names.map((_, i) => ({ f: `${col(i + 1)}${rw}*${col(i + 1)}${rSw}/$B$${rVar}`, v: e.riskContrib[i], s: 'pct' }))));
      const metric = (label, fx, v, sty, txt) => Pt.push([label, { f: fx, v, s: sty }, { v: txt, s: 'n' }]);
      metric('Rendimiento esperado E(Rp)', `SUMPRODUCT(${wR},$B$${rw + 1}:$${col(N)}$${rw + 1})`, e.ret, 'pctb', 'Σ wᵢ E(Rᵢ)');
      metric('Varianza σp²', `SUMPRODUCT(${wR},$B$${rSw}:$${col(N)}$${rSw})`, e.vol * e.vol, 'num6', 'wᵀ Σ w = Σ wᵢ (Σw)ᵢ');
      metric('Riesgo σp', `SQRT(B${rVar})`, e.vol, 'pctb', '√σp²');
      metric('Beta βp', `SUMPRODUCT(${wR},$B$${rw + 2}:$${col(N)}$${rw + 2})`, e.beta, 'num4', 'Σ wᵢ βᵢ');
      metric('Razón de Sharpe', `(B${rVar - 1}-Estadisticas!$B$5)/B${rVar + 1}`, e.sharpe, 'num4', '(E(Rp) − rf) / σp');
      metric('Razón de Treynor', `(B${rVar - 1}-Estadisticas!$B$5)/B${rVar + 2}`, e.treynor, 'pct', '(E(Rp) − rf) / βp');
      metric('Alfa de Jensen', `B${rVar - 1}-(Estadisticas!$B$5+B${rVar + 2}*(Estadisticas!$B$8-Estadisticas!$B$5))`, e.jensen, 'pct', 'E(Rp) − [rf + βp (E(Rm) − rf)]');
      metric('M² de Modigliani', `Estadisticas!$B$5+B${rVar + 3}*${cell('vol', 0)}`, e.m2, 'pct', 'rf + Sharpe × σm');
      metric('Número efectivo de activos', `1/SUMSQ(${wR})`, e.effN, 'num2', '1 / Σ wᵢ²');
      metric('Razón de diversificación', `SUMPRODUCT(${wR},$B$${rw + 3}:$${col(N)}$${rw + 3})/B${rVar + 1}`, e.divRatio, 'num4', 'Σ wᵢ σᵢ / σp');
      metric('Suma de pesos', `SUM(${wR})`, blk.w.reduce((q, x) => q + x, 0), 'pct', 'Debe dar 100 %');
      Pt.push([]);
      summaryRows.push([blk.label, e]);
    }

    /* ---------- Frontera ---------- */
    const Fr = [[{ v: 'Frontera eficiente de Markowitz', s: 't' }], [{ v: `Cada punto resuelve min ½ wᵀΣw − t·μᵀw con Σw = 1 y pesos entre ${pctTxt(s.wmin)} y ${pctTxt(s.wmax)}. t = 0 es la mínima varianza.`, s: 'n' }], []];
    Fr.push([{ v: 'σ anual', s: 'h' }, { v: 'E(R) anual', s: 'h' }, { v: 'Sharpe', s: 'h' }].concat(m.names.map((n) => ({ v: n, s: 'h' }))));
    for (const p of P.frontier) Fr.push([{ v: p.vol, s: 'pct' }, { v: p.ret, s: 'pct' }, { v: (p.ret - m.rf) / p.vol, s: 'num4' }].concat(p.w.map((x) => ({ v: x, s: 'pct' }))));

    /* ---------- Plan de compra ---------- */
    const Pl = [];
    const plan = ctx.plan;
    if (plan && plan.rows && (plan.rows.length || plan.safe > 0)) {
      const H = plan.years || 1;
      const rs = plan.safeRate == null ? m.rf : plan.safeRate;
      Pl.push([{ v: 'Plan de inversión con comisiones y horizonte', s: 't' }]);
      Pl.push([{ v: 'Acciones enteras para acciones y ETF; monto en pesos para renta fija, divisas y derivados. Comisión fija por cada compra y cada venta (los CDT no pagan). La renta fija segura rinde su tasa efectiva anual.', s: 'n' }]);
      Pl.push([]);
      Pl.push(['Presupuesto', { v: plan.budget, s: 'money' }]); // B4
      Pl.push(['Comisión por compra', { v: plan.feeBuy == null ? plan.fee : plan.feeBuy, s: 'money' }]); // B5
      Pl.push(['Comisión por venta', { v: plan.feeSell == null ? plan.fee : plan.feeSell, s: 'money' }]); // B6
      Pl.push(['Horizonte (años)', H]); // B7
      Pl.push(['Tasa de la renta fija segura (EA)', { v: rs, s: 'pct' }]); // B8
      Pl.push(['En renta fija segura', { v: plan.safe || 0, s: 'money' }]); // B9
      Pl.push(['Monto mínimo por inversión', { v: plan.minAmt || 0, s: 'money' }]); // B10
      Pl.push([]);
      Pl.push(['Activo', 'Tipo', 'Peso objetivo', 'Precio', 'Fecha del precio', 'Acciones', 'Monto', 'Peso real', 'Comisión de compra', 'Comisión de venta', 'E(R) del activo'].map((x) => ({ v: x, s: 'h' })));
      const r0 = 13;
      const r1 = r0 + Math.max(plan.rows.length, 1) - 1;
      const t = r1 + 1;
      plan.rows.forEach((r, k) => {
        const n = r0 + k;
        const monto = r.unit === 'monto';
        Pl.push([
          r.name,
          (PF.data.CLASSES || {})[r.cls] || '',
          { v: r.w, s: 'pct' },
          monto ? '' : { v: r.price, s: 'money' },
          r.date || '',
          monto ? '' : { v: r.shares, s: 'int' },
          monto ? { v: r.amount, s: 'money' } : { f: `D${n}*F${n}`, v: r.amount, s: 'money' },
          { f: `G${n}/$G$${t}`, v: r.realW, s: 'pct' },
          r.noFee ? { v: 0, s: 'money' } : { f: '$B$5', v: r.feeBuy, s: 'money' },
          r.noFee ? { v: 0, s: 'money' } : { f: '$B$6', v: r.feeSell, s: 'money' },
          { f: `INDEX(${estRange('exp')},MATCH(A${n},Estadisticas!$${C(1)}$12:$${C(N)}$12,0))`, v: m.mu[m.names.indexOf(r.name)], s: 'pct' },
        ]);
      });
      if (!plan.rows.length) Pl.push(['(todo en renta fija segura)']);
      const ev = PF.plan.evaluatePlan(m, plan, rs, H);
      Pl.push([{ v: 'Total', s: 'b' }, null, null, null, null, null, { f: `SUM(G${r0}:G${r1})`, v: plan.invested, s: 'moneyb' }, { f: `SUM(H${r0}:H${r1})`, v: plan.rows.length ? 1 : 0, s: 'pct' }, { f: `SUM(I${r0}:I${r1})`, v: plan.buyFees, s: 'moneyb' }, { f: `SUM(J${r0}:J${r1})`, v: plan.sellFees, s: 'moneyb' }]);
      Pl.push([]);
      const L = (label, fx, v, sty, txt) => Pl.push([label, { f: fx, v, s: sty }, { v: txt, s: 'n' }]);
      const q = t + 2; // primera fila de resultados
      L('Efectivo sin invertir', `B4-G${t}-I${t}-B9`, plan.cash, 'money', 'Presupuesto − invertido − comisiones de compra − renta fija segura');
      L('Rendimiento esperado del portafolio comprado', `SUMPRODUCT(H${r0}:H${r1},K${r0}:K${r1})`, ev.e.ret, 'pct', 'Σ peso real × E(R)');
      L(`Valor esperado en ${H} ${H === 1 ? 'año' : 'años'}`, `G${t}*(1+B${q + 1})^B7+B9*(1+B8)^B7+B${q}-J${t}`, ev.proj.value, 'moneyb', 'Invertido × (1 + E(Rp))^H + renta fija × (1 + tasa)^H + efectivo − comisiones de venta');
      L('Ganancia esperada neta', `B${q + 2}-B4`, ev.proj.gain, 'money', 'Valor esperado − presupuesto');
      L('Rendimiento neto anual', `(B${q + 2}/B4)^(1/B7)-1`, ev.netRet, 'pctb', '(valor / presupuesto)^(1/H) − 1');
      L('Rendimiento mínimo anual para cubrir comisiones', `IF(G${t}>0,(I${t}+J${t})/G${t}/B7,0)`, ev.breakEven, 'pct', '(comisiones de compra + venta) / invertido / H');
    }

    /* ---------- Formulas ---------- */
    const a1 = m.assets[0];
    const nm = a1 ? a1.name : '';
    const g = (x, d = 4) => (fin(x) ? x.toFixed(d).replace('.', ',') : '');
    const gp = (x) => (fin(x) ? (x * 100).toFixed(2).replace('.', ',') + ' %' : '');
    const Fo = [[{ v: 'Guía de fórmulas', s: 't' }], [{ v: `Cada concepto con su fórmula, la función de Excel que la calcula y un ejemplo con ${nm}.`, s: 'n' }], []];
    Fo.push(['Concepto', 'Fórmula', 'En Excel (español)', `Ejemplo con ${nm}`, 'Hoja'].map((x) => ({ v: x, s: 'h' })));
    const add = (...r) => Fo.push(r);
    add('Rendimiento del periodo', logRet ? 'rₜ = ln(Pₜ / Pₜ₋₁)' : 'rₜ = Pₜ / Pₜ₋₁ − 1', logRet ? '=LN(B3/B2)' : '=B3/B2-1', '', 'Rendimientos');
    add('Media', 'r̄ = Σ rₜ / n', '=PROMEDIO(rango)', g(means[1], 6), 'Estadisticas');
    add('Rendimiento anual', 'R = r̄ × f', '=media*f', `${g(means[1], 6)} × ${f} = ${gp(means[1] * f)}`, 'Estadisticas');
    add('Varianza', 's² = Σ (rₜ − r̄)² / (n − 1)', '=VAR.S(rango)', a1 ? g(PF.stats.variance(ret[1].filter(fin)), 6) : '', 'Estadisticas, Desviaciones');
    add('Desviación estándar y volatilidad anual', 'σ = √s² × √f', '=DESVEST.M(rango)*RAIZ(f)', a1 ? gp(Math.sqrt(PF.stats.variance(ret[1].filter(fin)) * f)) : '', 'Estadisticas');
    add('Covarianza', 'Cov(rᵢ, rⱼ) = Σ (rᵢ − r̄ᵢ)(rⱼ − r̄ⱼ) / (n − 1)', '=COVARIANZA.M(rango i; rango j)', '', 'Covarianza, Desviaciones');
    add('Correlación', 'ρᵢⱼ = Cov(rᵢ, rⱼ) / (σᵢ σⱼ)', '=COEF.DE.CORREL(rango i; rango j)', '', 'Correlacion');
    add('Covarianza anual usada', s.covModel === 'index' ? 'σᵢⱼ = βᵢ βⱼ σm² (+ σ²(εᵢ) si i = j)' : common ? 'σᵢⱼ = Cov(rᵢ, rⱼ) × f' : 'σᵢⱼ = ρᵢⱼ σᵢ σⱼ (anuales)', '', '', 'Covarianza');
    add('Beta', 'β = Cov(rᵢ, rm) / Var(rm)', '=PENDIENTE(rango i; rango mercado)', a1 ? g(a1.beta) : '', 'Estadisticas');
    add('R²', 'R² = ρ(rᵢ, rm)²', '=COEFICIENTE.R2(rango i; rango mercado)', a1 ? g(a1.r2) : '', 'Estadisticas');
    add('Alfa histórico', 'α = [intersección − rf/f × (1 − β)] × f', '=(INTERSECCION.EJE(rango i; rango mercado)-rf_periodo*(1-β))*f', a1 ? gp(a1.alphaHist) : '', 'Estadisticas');
    add('Rendimiento CAPM', 'E(R) = rf + β (E(Rm) − rf)', '=rf+β*(E(Rm)-rf)', a1 ? gp(a1.capmRet) : '', 'Estadisticas');
    add('Rendimiento esperado usado', MU_TXT[s.muModel], '', a1 ? gp(a1.expRet) : '', 'Estadisticas');
    add('Razón de Sharpe', 'S = (E(R) − rf) / σ', '=(E-rf)/σ', a1 ? g(a1.sharpe) : '', 'Estadisticas, Portafolios');
    add('Razón de Treynor', 'T = (E(R) − rf) / β', '=(E-rf)/β', a1 ? gp(a1.treynor) : '', 'Estadisticas, Portafolios');
    add('Alfa de Jensen', 'α = E(R) − [rf + β (E(Rm) − rf)]', '=E-(rf+β*(E(Rm)-rf))', a1 ? gp(a1.jensen) : '', 'Estadisticas, Portafolios');
    add('Rendimiento del portafolio', 'E(Rp) = Σ wᵢ E(Rᵢ)', '=SUMAPRODUCTO(pesos; E)', '', 'Portafolios');
    add('Varianza del portafolio', 'σp² = Σᵢ Σⱼ wᵢ wⱼ σᵢⱼ = Σ wᵢ (Σw)ᵢ', '=SUMAPRODUCTO(pesos; Σw)', '', 'Portafolios');
    add('Beta del portafolio', 'βp = Σ wᵢ βᵢ', '=SUMAPRODUCTO(pesos; β)', '', 'Portafolios');
    add('M² de Modigliani', 'M² = rf + Sharpe × σm', '', '', 'Portafolios');
    add('Número efectivo de activos', 'N = 1 / Σ wᵢ²', '=1/SUMA.CUADRADOS(pesos)', '', 'Portafolios');
    add('Razón de diversificación', 'DR = Σ wᵢ σᵢ / σp', '', '', 'Portafolios');
    add('Frontera eficiente', 'min ½ wᵀΣw − t μᵀw, Σw = 1, límites por activo', 'Solver (la app usa un método exacto de conjunto activo)', '', 'Frontera');
    add('Portafolio tangente', 'max (E(Rp) − rf) / σp', 'Solver', '', 'Portafolios');
    add('Portafolio recomendado', 'max E(Rp) sobre la frontera eficiente, con 1 / Σ wᵢ² ≥ N*', 'Solver (restricción: 1/SUMA.CUADRADOS(pesos) >= N*)', P.recommended && P.recommended.div ? 'N* = ' + g(P.recommended.div.target, 2) : '', 'Portafolios');
    add('Comisiones', 'Costo = comisión de compra × activos + comisión de venta × activos (los CDT no pagan)', '=SUMA(comisiones)', '', 'Plan_compra');
    add('Monto mínimo por inversión', '(comisión de compra + venta) / (1 % × H), sin pasar de la mitad del presupuesto', '', '', 'Plan_compra');
    add('Reparto con renta fija segura', 'mayor α con P(pérdida en H) ≤ p:  H·rs + α[H(μ − rs) − z σ √H] ≥ 0', '', '', 'Plan_compra');
    add('Valor esperado al horizonte', 'V = I (1 + E(Rp))^H + S (1 + rs)^H + efectivo − comisiones de venta', '', '', 'Plan_compra');
    add('Rendimiento neto anual', '(V / presupuesto)^(1/H) − 1', '', '', 'Plan_compra');

    /* ---------- Resumen ---------- */
    const Rs = [];
    Rs.push([{ v: 'Frontera Eficiente · cálculos del portafolio', s: 't' }]);
    Rs.push([{ v: 'Aplicación de Schrödistein. La teoría y los modelos son de los autores citados en la hoja Formulas.', s: 'n' }]);
    Rs.push([{ v: `Generado el ${ctx.generated || new Date().toISOString().slice(0, 10)}. Todas las cifras son anuales salvo que se indique.`, s: 'n' }]);
    Rs.push([]);
    Rs.push([{ v: 'Datos', s: 'b' }]);
    Rs.push(['Series', labels.join(', ')]);
    Rs.push(['Índice de referencia (no se invierte)', labels[0]]);
    Rs.push(['Periodo', `${table.dates[0]} a ${table.dates[T - 1]} (${T} fechas)`]);
    Rs.push(['Frecuencia', `${FREQ_TXT[s.freq] || s.freq} (f = ${f})${s.agg === 'avg' ? ', promedio del periodo' : ', último cierre del periodo'}`]);
    Rs.push(['Rendimientos', logRet ? 'Logarítmicos: ln(Pₜ / Pₜ₋₁)' : 'Simples: Pₜ / Pₜ₋₁ − 1']);
    Rs.push(['Fechas distintas entre activos', common ? 'Solo periodos comunes' : 'Toda la historia de cada activo (correlaciones por pares)']);
    Rs.push(['Tasa libre de riesgo', { v: m.rf, s: 'pct' }]);
    Rs.push(['E(Rm)', { v: m.Em, s: 'pct' }]);
    Rs.push(['Rendimiento esperado', MU_TXT[s.muModel]]);
    Rs.push(['Límites de peso', `${pctTxt(s.wmin)} a ${pctTxt(s.wmax)}`]);
    Rs.push([]);
    Rs.push([{ v: 'Portafolios', s: 'b' }]);
    Rs.push(['Portafolio', 'E(R)', 'σ', 'β', 'Sharpe', 'Treynor', 'α Jensen', 'N efectivo'].concat(m.names).map((x) => ({ v: x, s: 'h' })));
    for (const [label, e] of summaryRows) Rs.push([label, { v: e.ret, s: 'pct' }, { v: e.vol, s: 'pct' }, { v: e.beta, s: 'num4' }, { v: e.sharpe, s: 'num4' }, { v: e.treynor, s: 'pct' }, { v: e.jensen, s: 'pct' }, { v: e.effN, s: 'num2' }].concat(e.w.map((x) => ({ v: x, s: 'pct' }))));
    Rs.push([]);
    Rs.push([{ v: 'Hojas: Precios → Rendimientos → Estadisticas y Desviaciones → Covarianza y Correlacion → Portafolios, Frontera y Plan_compra. La hoja Formulas explica cada cálculo.', s: 'n' }]);

    const wide = (n, w) => Array.from({ length: n }, () => w);
    const sheets = [
      { name: 'Resumen', rows: Rs, cols: [34, 12, 12, 10, 10, 10, 10, 11].concat(wide(N, 12)) },
      { name: 'Precios', rows: precios, cols: [12].concat(wide(NS, 13)), freeze: { row: 1, col: 1 } },
      { name: 'Rendimientos', rows: rend, cols: [12].concat(wide(NS, 13)), freeze: { row: 1, col: 1 } },
      { name: 'Estadisticas', rows: E, cols: [44].concat(wide(NS, 14), [52, 60]), freeze: { row: 12, col: 1 } },
      { name: 'Desviaciones', rows: D, cols: [44].concat(wide(2 * NS + pairs.length, 14)), freeze: { row: 1, col: 1 } },
      { name: 'Covarianza', rows: Cv, cols: [16].concat(wide(NS, 13)) },
      { name: 'Correlacion', rows: Co, cols: [16].concat(wide(NS, 13)) },
      { name: 'Portafolios', rows: Pt, cols: [40].concat(wide(N, 13), [34]) },
      { name: 'Frontera', rows: Fr, cols: [12, 12, 10].concat(wide(N, 12)) },
    ];
    if (Pl.length) sheets.push({ name: 'Plan_compra', rows: Pl, cols: [44, 14, 13, 14, 11, 16, 11, 16, 16, 14] });
    // Referencias de la teoría usada (APA)
    Fo.push([], [{ v: 'Referencias', s: 'b' }]);
    for (const r of REFS) Fo.push([r]);
    sheets.push({ name: 'Formulas', rows: Fo, cols: [34, 48, 52, 30, 26] });
    return { sheets, bytes: () => X().build(sheets) };
  }

  function pairOf(a, b) {
    const x = [];
    const y = [];
    for (let t = 0; t < a.length; t++) if (fin(a[t]) && fin(b[t])) {
      x.push(a[t]);
      y.push(b[t]);
    }
    return [x, y];
  }
  const pctTxt = (x) => `${Math.round(x * 1000) / 10} %`.replace('.', ',');

  PF.report = { build };
})(typeof globalThis !== 'undefined' ? globalThis : this);
